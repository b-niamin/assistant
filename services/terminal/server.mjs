#!/usr/bin/env node
/**
 * Terminal sidecar (spec 004). A shell in the browser, for logging in to CLIs that keep their login
 * in $HOME: `claude` (/login, then remote-control picks it up), `codex login`, `gh auth login`...
 *
 * Runs in its own container from the claude image, sharing only the claude-home volume and the
 * checkout. No docker socket, no .env, no published port: the web app proxies /settings/terminal/ws
 * here after checking the session; this server checks the single-use ticket again.
 *
 *   GET  /status  -> {"claude": bool, "codex": bool, "gh": bool,       (booleans only, never file contents)
 *                     "remote": {"claude": state, "codex": state},     (remote-control in the claude container,
 *                     "background": {"claude": bool, "codex": bool}}    or started here in the background)
 *   POST /remote?agent=claude|codex&ticket=...  Start that agent's Remote Control in a detached tmux
 *                        session here (`remote-<agent>`), for when the claude container's is not running.
 *   GET  /ws?ticket=...  WebSocket. Client -> server text frames: "0<input>" or "1<cols> <rows>".
 *                        Server -> client binary frames: terminal output.
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
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

/**
 * Remote Control state of an agent in the `claude` container, from the file its entrypoint keeps in the
 * shared home (docker/llm/entrypoint.sh): starting, running, restarting, signed-out, or off when the file is
 * missing or its heartbeat (every 30 s) stopped.
 */
const REMOTE_STATES = new Set(['starting', 'running', 'restarting', 'signed-out']);
function remoteState(file, now = Date.now()) {
  try {
    if (now - statSync(file).mtimeMs > 90_000) return 'off';
    const { state } = JSON.parse(readFileSync(file, 'utf8'));
    return REMOTE_STATES.has(state) ? state : 'off';
  } catch {
    return 'off';
  }
}

/** Remote Control started from the app in the background: a detached tmux session per agent. */
// Claude only: Codex runs as a daemon in the llm container, and a second one on the same home would clash.
const REMOTE_COMMANDS = { claude: 'claude remote-control' };
const tmuxConf = () => path.join(HERE, 'tmux.conf');
const backgroundRuns = (agent) =>
  spawnSync('tmux', ['-f', tmuxConf(), 'has-session', '-t', `=remote-${agent}`], { env: shellEnv(), stdio: 'ignore' }).status === 0;

function startBackground(agent) {
  if (backgroundRuns(agent)) return true;
  const r = spawnSync('tmux', ['-f', tmuxConf(), 'new-session', '-d', '-s', `remote-${agent}`, '-c', WORKSPACE, REMOTE_COMMANDS[agent]], {
    cwd: WORKSPACE,
    env: shellEnv(),
    stdio: 'ignore'
  });
  return r.status === 0;
}

/**
 * Why an agent's Remote Control keeps failing, from the end of its log (~/.beni/remote/<agent>.log, written
 * by the llm container): one known cause as a word, '' when none is recognised. Never the log itself.
 */
const REASONS = [
  ['mfa', /Multi-factor authentication required/i],
  ['signed-out', /401 Unauthorized|Please try signing in again|not logged in/i]
];
function remoteReason(text) {
  // Only the last attempt counts: an earlier failure may have been fixed since.
  const last = text.slice(Math.max(0, text.lastIndexOf('Starting app-server')));
  return REASONS.find(([, re]) => re.test(last))?.[0] ?? '';
}
function logTail(file, bytes = 16384) {
  try {
    const fd = openSync(file, 'r');
    try {
      const size = statSync(file).size;
      const buf = Buffer.alloc(Math.min(bytes, size));
      readSync(fd, buf, 0, buf.length, size - buf.length);
      return buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://terminal');
  // A short-lived code to pair a device with the Codex daemon (its control socket is in the shared home).
  if (req.method === 'POST' && url.pathname === '/remote/pair') {
    if (!verify(url.searchParams.get('ticket'), 'terminal')) {
      res.statusCode = 403;
      res.end();
      return;
    }
    // The daemon runs in llm; its socket (a link into /tmp/codex-daemon-<uid>, shared by compose) is there only while it runs.
    const sock = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'app-server-control/app-server-control.sock');
    if (!existsSync(sock)) {
      log('codex pairing code requested: daemon not running');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: false, text: 'Codex Remote Control is not running yet. Sign in to Codex, wait for it to show as running, then try again.' }));
      return;
    }
    const r = spawnSync('codex', ['remote-control', 'pair'], { cwd: WORKSPACE, env: shellEnv(), encoding: 'utf8', timeout: 20_000 });
    // eslint-disable-next-line no-control-regex
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().slice(0, 2000);
    log(`codex pairing code requested: ${r.status === 0 ? 'ok' : 'failed'}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: r.status === 0, text }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/remote') {
    const agent = url.searchParams.get('agent') ?? '';
    // Same single-use ticket as a shell: only the web app, for an unlocked session, can start one.
    if (!verify(url.searchParams.get('ticket'), 'terminal') || !Object.hasOwn(REMOTE_COMMANDS, agent)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const ok = startBackground(agent);
    log(`background remote-control ${agent}: ${ok ? 'running' : 'failed to start'}`);
    res.statusCode = ok ? 200 : 500;
    res.end();
    return;
  }
  if (url.pathname === '/status') {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        // .claude.json appears on the first run, before any login: only an oauthAccount in it counts.
        claude: nonEmpty(path.join(HOME, '.claude/.credentials.json')) || mentions(path.join(HOME, '.claude.json'), '"oauthAccount"'),
        codex: nonEmpty(path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'auth.json')),
        gh: nonEmpty(path.join(HOME, '.config/gh/hosts.yml')),
        remote: {
          claude: remoteState(path.join(HOME, '.beni/remote/claude.json')),
          codex: remoteState(path.join(HOME, '.beni/remote/codex.json'))
        },
        background: { claude: backgroundRuns('claude'), codex: backgroundRuns('codex') },
        reasons: {
          claude: remoteReason(logTail(path.join(HOME, '.beni/remote/claude.log'))),
          // The daemon's own log: only its end, an older failure may have been fixed since.
          codex: remoteReason(logTail(path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'app-server-daemon/daemon.stderr.log'), 4096))
        }
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
