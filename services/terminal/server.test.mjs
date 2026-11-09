// Run: node --test services/terminal
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { acceptKey, createParser, encodeFrame } from './ws.mjs';
import { createVerifier, mintTicket } from './ticket.mjs';

const SECRET = 'x'.repeat(40);

test('ticket: valid once, bound to audience, session and time', () => {
  const verify = createVerifier(SECRET);
  const t = mintTicket(SECRET, 'terminal', 'sid-1', 1000);
  assert.equal(verify(t, 'browser', 'sid-1', 1000), null, 'wrong audience');
  assert.equal(verify(t, 'terminal', 'sid-2', 1000), null, 'wrong session');
  assert.equal(verify(t, 'terminal', 'sid-1', 1000 + 61_000), null, 'expired');
  assert.ok(verify(t, 'terminal', 'sid-1', 1000));
  assert.equal(verify(t, 'terminal', 'sid-1', 1000), null, 'replay');
  assert.equal(createVerifier(SECRET)(t.slice(0, -2) + 'AA', 'terminal', 'sid-1', 1000), null, 'forged mac');
  assert.equal(createVerifier('y'.repeat(40))(t, 'terminal', 'sid-1', 1000), null, 'other secret');
  assert.throws(() => mintTicket('short', 'terminal', 's'));
});

const masked = (opcode, text) => {
  const data = Buffer.from(text);
  const mask = randomBytes(4);
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i++) out[i] ^= mask[i & 3];
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | data.length]), mask, out]);
};

test('ws: accept key from RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('ws: parser unmasks split frames and rejects unmasked ones', () => {
  const got = [];
  const parse = createParser((op, p) => got.push([op, p.toString()]));
  const f = Buffer.concat([masked(1, 'hello'), masked(2, 'bin')]);
  parse(f.subarray(0, 3));
  parse(f.subarray(3));
  assert.deepEqual(got, [[1, 'hello'], [2, 'bin']]);
  assert.throws(() => createParser(() => {})(encodeFrame(1, 'x')));
});

test('server: rejects without ticket, runs a shell with one', async (t) => {
  const port = 17000 + Math.floor(Math.random() * 1000);
  // A private tmux socket dir, so the test never touches anyone's real tmux server.
  const TMUX_TMPDIR = mkdtempSync(path.join(tmpdir(), 'term-test-'));
  const srv = spawn('node', [new URL('./server.mjs', import.meta.url).pathname], {
    env: { ...process.env, TERMINAL_PORT: String(port), SIDECAR_TICKET_SECRET: SECRET, HOME: TMUX_TMPDIR, TMUX_TMPDIR, TERMINAL_WATCH: '0' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(() => {
    srv.kill();
    spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR } });
  });
  await new Promise((r) => srv.stdout.once('data', r));

  // Remote Control state from the claude container's files: fresh, stale (no heartbeat) or missing.
  const remote = path.join(TMUX_TMPDIR, '.beni/remote');
  mkdirSync(remote, { recursive: true });
  writeFileSync(path.join(remote, 'claude.json'), '{"state":"running","since":1}');
  writeFileSync(path.join(remote, 'codex.json'), '{"state":"running","since":1}');
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(path.join(remote, 'codex.json'), old, old);
  const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
  assert.deepEqual(status.remote, { claude: 'running', codex: 'off' });
  assert.equal(status.claude, false);
  assert.deepEqual(status.background, { claude: false, codex: false });
  // Starting a background Remote Control needs a ticket and a known agent.
  const post = (q) => fetch(`http://127.0.0.1:${port}/remote?${q}`, { method: 'POST' }).then((r) => r.status);
  assert.equal(await post('agent=claude'), 403);
  assert.equal(await post(`agent=rm&ticket=${mintTicket(SECRET, 'terminal', 'sid')}`), 403);

  const upgrade = (q) =>
    new Promise((resolve) => {
      const s = connect(port, '127.0.0.1', () =>
        s.write(
          `GET /ws?${q} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
        )
      );
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString('latin1');
        if (buf.includes('\r\n\r\n')) resolve({ s, head: buf });
      });
    });
  const bad = await upgrade('ticket=nope');
  assert.match(bad.head, /403/);
  bad.s.destroy();
  const ok = await upgrade(`ticket=${mintTicket(SECRET, 'terminal', 'sid')}`);
  assert.match(ok.head, /101/);
  let out = ok.head;
  const done = new Promise((resolve) =>
    ok.s.on('data', (d) => {
      out += d.toString('latin1');
      if (out.includes('pty-ok-42')) resolve();
    })
  );
  ok.s.write(masked(1, '0echo pty-ok-$((40+2))\r'));
  await Promise.race([done, new Promise((r) => setTimeout(r, 4000))]);
  ok.s.destroy();
  if (spawnSync('tmux', ['-V']).status === 0) assert.match(out, /pty-ok-42/);
  else t.diagnostic('no tmux here: shell output not checked');
});
