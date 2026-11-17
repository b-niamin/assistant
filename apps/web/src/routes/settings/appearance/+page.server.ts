/** System settings -> Appearance (spec 001): the mascot's name and kind, and the accent theme, for everyone. */
import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { appearance, saveAppearance } from '#lib/server/appearance.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async () => ({ current: await appearance() });

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const f = await request.formData();
    await saveAppearance({ name: f.get('name'), kind: f.get('kind'), accent: f.get('accent') });
    return { ok: t('Saved.') };
  }
};
