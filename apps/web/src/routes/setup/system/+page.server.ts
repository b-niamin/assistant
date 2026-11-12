/**
 * First-run wizard, step 3: how updates happen (and, until the updater ticks, how to schedule it) and
 * whether Claude may reach the apps (MCP on the internet, spec 005). Both are requests to the host's
 * updater, like in System settings.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { isStale, setUpdaterControl, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  const [control, status, unlocked] = await Promise.all([updaterControl(), updaterStatus(), isElevated(cookies.get(SESSION_COOKIE))]);
  return {
    mode: control.mode,
    funnel: control.funnel ?? 'off',
    updater: !!status,
    // Not ticking yet (no heartbeat, or none for a while): on Synology its schedule is added by hand.
    ticking: !!status && !!status.checkedAt && !isStale(status),
    home: status?.home ?? '',
    schedule: status?.schedule ?? '',
    unlocked
  };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const f = await request.formData();
    const mode = f.get('mode') === 'manual' ? 'manual' : 'auto';
    const funnel = f.get('funnel') === 'on' ? 'on' : 'off';
    await setUpdaterControl({ ...(await updaterControl()), mode, funnel });
    console.log(`[setup] ${new Date().toISOString()} updates ${mode}, MCP on the internet ${funnel}`);
    throw redirect(303, '/setup/done');
  }
};
