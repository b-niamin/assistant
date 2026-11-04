#!/usr/bin/env node
/**
 * Production entry: the SvelteKit handler plus a guarded WebSocket proxy to the sidecars (spec 004).
 * adapter-node's build/index.js cannot accept WebSocket upgrades, so this file owns the HTTP server.
 *
 *   /settings/terminal/ws?ticket=...  -> terminal:7681/ws   (shell in the terminal container)
 *   /settings/browser/ws?ticket=...   -> browser:6080/      (noVNC view of the browser container)
 *
 * An upgrade is proxied only when ALL hold: the Origin is this app's ORIGIN, the request carries a
 * session cookie, and the ticket is valid, unused, for that sidecar and minted for that session.
 * Tickets come from POST /settings/ticket, which requires an elevated session (password re-entered).
 */
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { handler } from './build/handler.js';
import { createVerifier, sidHash } from './src/lib/server/sidecar-ticket.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const ORIGIN = process.env.ORIGIN ?? '';
const verify = createVerifier(process.env.SIDECAR_TICKET_SECRET ?? '');

const ROUTES = {
  '/settings/terminal/ws': { aud: 'terminal', target: process.env.TERMINAL_ADDR ?? 'terminal:7681', path: '/ws' },
  '/settings/browser/ws': { aud: 'browser', target: process.env.BROWSER_VNC_ADDR ?? 'browser:6080', path: '/' }
};

const log = (msg) => console.log(`[sidecar-proxy] ${new Date().toISOString()} ${msg}`);

function cookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const deny = (socket, code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);

const server = createServer(handler);

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const route = ROUTES[url.pathname];
  if (!route) return deny(socket, 404, 'Not Found');
  const ip = req.headers['x-forwarded-for'] ?? socket.remoteAddress;
  if (!ORIGIN || req.headers.origin !== ORIGIN) {
    log(`${route.aud}: bad origin ${req.headers.origin} from ${ip}`);
    return deny(socket, 403, 'Forbidden');
  }
  const sid = cookie(req.headers.cookie, 'sid');
  const ticket = url.searchParams.get('ticket');
  if (!sid || !verify(ticket, route.aud, sid)) {
    log(`${route.aud}: bad ticket from ${ip}`);
    return deny(socket, 403, 'Forbidden');
  }
  const [host, port] = route.target.split(':');
  const upstream = connect(Number(port), host, () => {
    // Forward the handshake. The ticket goes along: the terminal verifies it again (single use there
    // too). Cookies do not: the sidecars never see the session id.
    const query = new URLSearchParams({ ticket });
    for (const k of ['cols', 'rows']) if (url.searchParams.has(k)) query.set(k, url.searchParams.get(k));
    // Origin: the browser sidecar's websockify accepts only this app's ORIGIN (checked above), so a web
    // page open in that browser cannot open the VNC itself (spec 004).
    const lines = [
      `GET ${route.path}?${query} HTTP/1.1`,
      `Host: ${route.target}`,
      `Origin: ${ORIGIN}`,
      `X-Forwarded-For: ${ip}`
    ];
    for (const [k, v] of Object.entries(req.headers)) {
      if (/^(sec-websocket-(key|version|protocol)|upgrade|connection)$/i.test(k)) lines.push(`${k}: ${v}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
    log(`${route.aud}: opened sid=${sidHash(sid).slice(0, 8)} from ${ip}`);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', (e) => {
    log(`${route.aud}: upstream ${route.target} unreachable (${e.code ?? e.message})`);
    deny(socket, 502, 'Bad Gateway');
  });
  socket.on('error', close);
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

server.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));
