/**
 * GET -> what the dock at the bottom of every page shows: the terminal's sign-ins, the Remote Control
 * sessions (the claude container's and any started here in the background), whether an update is
 * being deployed (or the updater stopped), and whether this session may open the terminal (unlocked). States only, never file contents. Any logged-in session may read it.
 *
 * POST {start: 'claude' | 'codex'} -> start that agent's Remote Control in the background of the terminal
 * container. Unlocked sessions only, like opening a shell.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { sidecarsConfigured, startBackgroundRemote, terminalStatus } from '#lib/server/sidecars.ts';
import { updateView, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const GET: RequestHandler = async ({ cookies, locals }) => {
  if (!locals.authenticated) return json({ error: 'Log in first.' }, { status: 401 });
  const [status, unlocked, u, c] = await Promise.all([terminalStatus(), isElevated(cookies.get(SESSION_COOKIE)), updaterStatus(), updaterControl()]);
  // The host's updater: shown in the dock while it updates, when an update was interrupted, or when it has stopped.
  const update = u
    ? { state: updateView(u, c).state, sha: u.sha.slice(0, 7), actions: u.status === 'updating' ? u.actions : '', step: u.step, steps: u.steps }
    : null;
  return json({ ...status, configured: sidecarsConfigured(), unlocked, update }, { headers: { 'cache-control': 'no-store' } });
};

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const sid = cookies.get(SESSION_COOKIE);
  if (!locals.authenticated || !sid || !(await isElevated(sid))) throw error(403, 'Re-enter the password first.');
  if (!sidecarsConfigured()) throw error(503, 'SIDECAR_TICKET_SECRET is not set.');
  const { start } = (await request.json().catch(() => ({}))) as { start?: string };
  if (start !== 'claude' && start !== 'codex') throw error(400, 'Unknown agent.');
  console.log(`[dock] ${new Date().toISOString()} start ${start} remote-control in the background`);
  const code = await startBackgroundRemote(start, sid);
  if (code === 404)
    throw error(503, 'The terminal container still runs the previous version: it restarts when the update has finished building.');
  if (code === 0) throw error(502, 'The terminal container is not answering.');
  if (code !== 200) throw error(502, `The terminal container could not start it (HTTP ${code}).`);
  return json({ ok: true });
};
