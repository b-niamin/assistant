#!/usr/bin/env node
/**
 * Terminal sidecar (spec 004). A shell in the browser, for logging in to CLIs that keep their login
 * in $HOME: `claude` (/login, then remote-control picks it up), `codex login`, `gh auth login`...
 *
 * Runs in its own container from the claude image, sharing only the claude-home volume and the
 * checkout. No docker socket, no .env, no published port: the web app proxies /settings/terminal/ws
 * here after checking the session; this server checks the single-use ticket again.
 *
 *   GET  /status  -> {"claude": bool, "codex": bool, "gh": bool}   (booleans only, never file contents)
 *   GET  /ws?ticket=...  WebSocket. Client -> server text frames: "0<input>" or "1<cols> <rows>".
 *                        Server -> client binary frames: terminal output.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifier } from './ticket.mjs';
import { handshake, wrap } from './ws.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TERMINAL_PORT ?? 7681);
const SECRET = process.env.SIDECAR_TICKET_SECRET ?? '';
const HOME = process.env.HOME ?? '/home/claude';
const MAX_SESSION_MS = 8 * 3600 * 1000;
const verify = createVerifier(SECRET);
delete process.env.SIDECAR_TICKET_SECRET;

const log = (msg) => console.log(`[terminal] ${new Date().toISOString()} ${msg}`);
const nonEmpty = (p) => {
  try {
    return statSync(p).size > 0;
  } catch {
    return false;
  }
};

// The shell gets a clean environment: nothing from this server's env leaks into it.
const shellEnv = () => ({
  HOME,
  USER: 'claude',
  SHELL: '/bin/bash',
  TERM: 'xterm-256color',
  LANG: 'C.UTF-8',
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  TZ: process.env.TZ ?? 'UTC',
  ...(process.env.TMUX_TMPDIR ? { TMUX_TMPDIR: process.env.TMUX_TMPDIR } : {}),
  ...(process.env.CLAUDE_RO_DATABASE_URL ? { CLAUDE_RO_DATABASE_URL: process.env.CLAUDE_RO_DATABASE_URL } : {}),
  // Tools for Claude (spec 005), used by the `assistant` MCP server.
  ...(process.env.CLAUDE_TOOLS_TOKEN ? { CLAUDE_TOOLS_TOKEN: process.env.CLAUDE_TOOLS_TOKEN, ASSISTANT_URL: process.env.ASSISTANT_URL ?? 'http://web:3000' } : {})
});

const mentions = (p, needle) => {
  try {
    return readFileSync(p, 'utf8').includes(needle);
  } catch {
    return false;
  }
};

const server = createServer((req, res) => {
  if (req.url === '/status') {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        // .claude.json appears on the first run, before any login: only an oauthAccount in it counts.
        claude: nonEmpty(path.join(HOME, '.claude/.credentials.json')) || mentions(path.join(HOME, '.claude.json'), '"oauthAccount"'),
        codex: nonEmpty(path.join(HOME, '.codex/auth.json')),
        gh: nonEmpty(path.join(HOME, '.config/gh/hosts.yml'))
      })
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

const WORKSPACE = existsSync('/workspace') ? '/workspace' : HOME;
const AGENTS = { claude: 'claude -c 2>/dev/null || claude', codex: 'codex' };
/**
 * Which tmux session to attach: `web` (the plain shell) by default, or a named one that starts an AI CLI
 * the first time (`-A` attaches to it later, so the conversation goes on). `dir` is an installed
 * extension, so Claude works in its folder and `claude -c` continues that folder's last conversation.
 * Only fixed commands and checked names: the URL never reaches the shell as text.
 */
function sessionOf(params) {
  const name = params.get('session') ?? '';
  const session = /^[a-z][a-z0-9-]{0,40}$/.test(name) ? name : 'web';
  const ext = params.get('dir') ?? '';
  const extDir = /^[a-z][a-z0-9-]*$/.test(ext) ? path.join(WORKSPACE, 'extensions', ext) : '';
  const cwd = extDir && existsSync(extDir) ? extDir : WORKSPACE;
  const agent = AGENTS[params.get('start') ?? ''];
  // After the agent exits, a login shell stays in the window.
  return { session, cwd, start: session !== 'web' && agent ? [`${agent}; exec bash -l`] : [] };
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url ?? '/', 'http://terminal');
  const ip = req.headers['x-forwarded-for'] ?? socket.remoteAddress;
  const ticket = url.pathname === '/ws' ? verify(url.searchParams.get('ticket'), 'terminal') : null;
  if (!ticket) {
    log(`rejected upgrade from ${ip}`);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!handshake(req, socket)) return;
  const cols = Number(url.searchParams.get('cols')) || 100;
  const rows = Number(url.searchParams.get('rows')) || 30;
  // tmux keeps the shell (and a half-finished `claude /login`) alive across reconnects. tmux.conf only
  // styles the status line to match the app; tmux reads it when its server starts.
  const { session, start, cwd } = sessionOf(url.searchParams);
  const tmux = ['tmux', '-f', path.join(HERE, 'tmux.conf'), 'new-session', '-A', '-s', session, '-c', cwd, ...start];
  const child = spawn('python3', ['-I', path.join(HERE, 'ptyhost.py'), ...tmux], {
    cwd,
    env: { ...shellEnv(), COLS: String(cols), ROWS: String(rows) },
    stdio: ['pipe', 'pipe', 'inherit', 'pipe']
  });
  log(`session opened sid=${ticket.sid.slice(0, 8)} from ${ip}`);
  const ws = wrap(socket, {
    onMessage(msg, binary) {
      const text = binary ? msg.toString('utf8') : msg;
      if (text[0] === '0') child.stdin.write(text.slice(1));
      else if (text[0] === '1') child.stdio[3].write(`${text.slice(1)}\n`);
    },
    onClose() {
      child.kill('SIGTERM');
    }
  });
  const limit = setTimeout(() => ws.close(1000), MAX_SESSION_MS);
  child.stdout.on('data', (d) => ws.send(d));
  child.on('exit', () => {
    clearTimeout(limit);
    log(`session closed sid=${ticket.sid.slice(0, 8)}`);
    ws.close(1000);
  });
});

if (SECRET.length < 32) {
  log('SIDECAR_TICKET_SECRET is missing or shorter than 32 chars; refusing every connection');
}
server.listen(PORT, '0.0.0.0', () => log(`listening on :${PORT}`));
