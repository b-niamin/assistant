/**
 * First-run wizard, step 3: how updates happen and whether Claude may reach the apps (the Claude
 * connector, spec 005). Both are requests to the host's updater, like in System settings.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { setUpdaterControl, updaterControl, updaterStatus } from '#lib/server/updater.ts';

export const load: PageServerLoad = async () => {
  const [control, status] = await Promise.all([updaterControl(), updaterStatus()]);
  return { mode: control.mode, funnel: control.funnel ?? 'off', updater: !!status };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const f = await request.formData();
    const mode = f.get('mode') === 'manual' ? 'manual' : 'auto';
    const funnel = f.get('funnel') === 'on' ? 'on' : 'off';
    await setUpdaterControl({ ...(await updaterControl()), mode, funnel });
    console.log(`[setup] ${new Date().toISOString()} updates ${mode}, Claude connector ${funnel}`);
    throw redirect(303, '/setup/done');
  }
};
