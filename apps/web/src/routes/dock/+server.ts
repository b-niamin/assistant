/**
 * GET -> what the dock at the bottom of every page shows: the terminal's sign-ins, the Remote Control
 * sessions of the `claude` container, and whether this session may open the terminal (unlocked).
 * States only, never file contents. Any logged-in session may read it; opening a shell needs the unlock.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';

export const GET: RequestHandler = async ({ cookies, locals }) => {
  if (!locals.authenticated) return json({ error: 'Log in first.' }, { status: 401 });
  const [status, unlocked] = await Promise.all([terminalStatus(), isElevated(cookies.get(SESSION_COOKIE))]);
  return json({ ...status, configured: sidecarsConfigured(), unlocked }, { headers: { 'cache-control': 'no-store' } });
};
