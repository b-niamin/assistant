/**
 * System settings -> Updates (spec 006): what runs, what GitHub's main has, the host's updater and its
 * progress. Update, resume, cancel and restart are requests the updater takes on its next run (every minute).
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { buildTail, latestOnGithub, setUpdaterControl, updateView, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ cookies, depends }) => {
  depends('app:updates');
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=updates');
  const [updates, updateControl] = await Promise.all([updaterStatus(), updaterControl()]);
  return {
    updates,
    updateView: updates ? updateView(updates, updateControl) : null,
    // main on GitHub right now (null when it does not answer): a newer commit shows "Update" at once.
    // Streamed: the page does not wait up to 4 s for GitHub (or for no internet) before it shows.
    latestSha: updates?.repo ? latestOnGithub(updates.repo, updates.branch).catch(() => null) : null,
    updateControl,
    buildTail: updates?.status === 'updating' || updates?.status === 'failed' ? await buildTail() : []
  };
};

const guard = async (cookies: { get(n: string): string | undefined }) => isElevated(cookies.get(SESSION_COOKIE));
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export const actions: Actions = {
  /** Automatic or manual updates; the host's updater reads it on its next run (spec 006). */
  updateMode: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const mode = str(await request.formData(), 'mode') === 'manual' ? 'manual' : 'auto';
    await setUpdaterControl({ ...(await updaterControl()), mode });
    return { ok: mode === 'manual' ? t('Manual updates: the app shows new versions and waits for "Update now".') : t('Automatic updates.') };
  },

  /** "Update now" (also "Retry" and "Resume"): a request the updater takes at its next run, within a minute
   * (it deploys GitHub main, nothing else). */
  updateNow: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), request: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} update requested`);
    return { ok: t('Update requested: it starts within a minute.') };
  },

  /** Restarts of the terminal: asked for first, or automatic (spec 006). */
  updateRestarts: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    const restarts = str(await request.formData(), 'restarts') === 'auto' ? 'auto' : 'ask';
    await setUpdaterControl({ ...(await updaterControl()), restarts });
    return { ok: restarts === 'auto' ? t('Updates restart the terminal by themselves.') : t('Updates ask before restarting the terminal.') };
  },

  /** "Restart now": the updater recreates the services that wait for it, within a minute. */
  updateRestart: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), restart: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} restart of the held services requested`);
    return { ok: t('Restart requested: it starts within a minute.') };
  },

  /** "Cancel" during an update: the updater's next run stops the running one (old containers stay). */
  updateCancel: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
    await setUpdaterControl({ ...(await updaterControl()), cancel: new Date().toISOString() });
    console.log(`[settings] ${new Date().toISOString()} update cancel requested`);
    return { ok: t('Cancelling: the updater stops the update within a minute.') };
  }
};
