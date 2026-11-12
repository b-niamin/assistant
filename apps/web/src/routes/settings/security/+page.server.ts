/**
 * System settings -> Security: the one app password, and locking settings again before the 10 minutes end.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { passwordFromEnv, passwordProblem, setPassword } from '#lib/server/app-config.ts';
import { deleteOtherSessions, isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=security');
  return { passwordFromEnv: passwordFromEnv() };
};

export const actions: Actions = {
  password: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    if (passwordFromEnv()) return fail(400, { error: t('The password is set in .env (APP_PASSWORD_HASH); change it there.') });
    const f = await request.formData();
    const problem = passwordProblem(String(f.get('password') ?? ''), String(f.get('repeat') ?? ''));
    if (problem) return fail(400, { error: t(problem) });
    await setPassword(String(f.get('password')));
    // Whoever knew the old password may still hold a session: log every other device out.
    const n = await deleteOtherSessions(cookies.get(SESSION_COOKIE));
    return { ok: t('Password changed.') + ' ' + t.n(n, '{n} other session logged out.', '{n} other sessions logged out.') };
  }
};
