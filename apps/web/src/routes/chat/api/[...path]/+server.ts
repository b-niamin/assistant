/**
 * The page /chat talks to the terminal container's chat (services/terminal/chat.mjs) through here: each
 * request gets a fresh single-use "chat" ticket for this session. Reading needs a logged-in session; anything
 * that makes Claude act (a new chat, a message, an answer, stop, delete) needs the unlocked session or the
 * chat grant it leaves behind (chat-grant.ts). The event stream (…/stream) is passed through as it comes.
 */
import { error, type RequestHandler } from '@sveltejs/kit';
import { grantChat, hasChatGrant } from '#lib/server/chat-grant.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { chatTicket, sidecarsConfigured, terminalAddr } from '#lib/server/sidecars.ts';

const PATH_RE = /^([a-f0-9]{16}(\/(stream|send|answer|stop))?)?$/;

async function canAct(sid: string): Promise<boolean> {
  if (await isElevated(sid)) {
    grantChat(sid);
    return true;
  }
  return hasChatGrant(sid);
}

const proxy: RequestHandler = async ({ request, params, url, cookies, locals }) => {
  const sid = cookies.get(SESSION_COOKIE);
  if (!locals.authenticated || !sid) throw error(401, 'Log in first.');
  if (!sidecarsConfigured()) throw error(503, 'SIDECAR_TICKET_SECRET is not set.');
  const path = params.path ?? '';
  if (!PATH_RE.test(path)) throw error(404, 'Not found');
  if (request.method !== 'GET' && !(await canAct(sid))) throw error(403, 'locked');
  const target = `http://${terminalAddr()}/chat${path ? `/${path}` : ''}${url.search}`;
  let res: Response;
  try {
    res = await fetch(target, {
      method: request.method,
      headers: { 'x-ticket': chatTicket(sid), 'content-type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined,
      signal: request.signal
    });
  } catch {
    throw error(502, 'The terminal container is not reachable.');
  }
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' }
  });
};

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
