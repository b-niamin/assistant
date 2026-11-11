/**
 * GET -> what the header and the dock at the bottom of every page show: the terminal's sign-ins, whether
 * an update is being deployed (or the updater stopped), the default AI CLI (claude or codex), and whether
 * this session is unlocked (the header's lock: the terminal shows only then). States only, never file
 * contents. Any logged-in session may read it.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { defaultAgent } from '#lib/server/app-config.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { sidecarsConfigured, terminalStatus } from '#lib/server/sidecars.ts';
import { updateView, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const GET: RequestHandler = async ({ cookies, locals }) => {
  if (!locals.authenticated) return json({ error: 'Log in first.' }, { status: 401 });
  const [status, unlocked, u, c, agent] = await Promise.all([
    terminalStatus(),
    isElevated(cookies.get(SESSION_COOKIE)),
    updaterStatus(),
    updaterControl(),
    defaultAgent().catch((e) => {
      console.warn(`[dock] default agent unreadable, using claude: ${e instanceof Error ? e.message : e}`);
      return 'claude' as const;
    })
  ]);
  // The host's updater: shown while it updates, when an update was interrupted, or when it has stopped.
  const update = u
    ? {
        state: updateView(u, c).state,
        sha: u.sha.slice(0, 7),
        actions: u.status === 'updating' ? u.actions : '',
        step: u.step,
        steps: u.steps,
        pendingRestart: u.pendingRestart
      }
    : null;
  return json({ ...status, configured: sidecarsConfigured(), unlocked, update, defaultAgent: agent }, { headers: { 'cache-control': 'no-store' } });
};
