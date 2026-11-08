/** POST {aud} -> {ticket}: a 60 s single-use ticket to open a sidecar WebSocket (spec 004). */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { SIDECARS, sidecarsConfigured, ticketFor, type Sidecar } from '#lib/server/sidecars.ts';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const sid = cookies.get(SESSION_COOKIE);
  // Checked here as well as by the /settings guard: this endpoint hands out shell access.
  if (!sid || !(await isElevated(sid))) throw error(403, 'Re-enter the password first.');
  if (!sidecarsConfigured()) throw error(503, 'SIDECAR_TICKET_SECRET is not set.');
  const { aud } = (await request.json().catch(() => ({}))) as { aud?: string };
  if (!SIDECARS.includes(aud as Sidecar)) throw error(400, 'Unknown sidecar.');
  console.log(`[sidecar-proxy] ${new Date().toISOString()} ticket for ${aud} to ${getClientAddress()}`);
  return json({ ticket: ticketFor(aud as Sidecar, sid) }, { headers: { 'cache-control': 'no-store' } });
};
