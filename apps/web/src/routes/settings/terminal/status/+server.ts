/** GET -> which CLIs are logged in, so the terminal page can update its sign-in cards after a login. */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isElevated, SESSION_COOKIE } from '$lib/server/session';
import { terminalStatus } from '$lib/server/sidecars';

export const GET: RequestHandler = async ({ cookies }) => {
  // Same guard as the page itself: only an unlocked (elevated) session.
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw error(403, 'Re-enter the password first.');
  return json(await terminalStatus(), { headers: { 'cache-control': 'no-store' } });
};
