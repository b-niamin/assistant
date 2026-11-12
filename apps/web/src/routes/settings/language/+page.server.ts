/**
 * System settings -> Language (spec 007): which languages the app offers and every extension is translated
 * into, the default among them, and the apps that still lack one.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { LANG_COOKIE, LANGUAGES, localizeExtension, pickLanguage, tFor } from '#lib/i18n/index.ts';
import { languageSettings, saveLanguageSettings } from '#lib/server/languages.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=language');
  const [all, languages] = await Promise.all([allExtensions(), languageSettings()]);
  const extensions = all.map((e) => localizeExtension(e, locals.lang));
  return {
    ...languages,
    all: LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
    missing: extensions
      .map((e) => ({ id: e.id, name: e.name, langs: languages.enabled.filter((l) => !e.languages.includes(l)) }))
      .filter((e) => e.langs.length)
  };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const f = await request.formData();
    const saved = await saveLanguageSettings({ enabled: f.getAll('enabled').map(String), default: String(f.get('default') ?? '').trim() });
    // The new default may be another language than this page's: answer in the one the next page shows.
    return { ok: tFor(pickLanguage(saved, cookies.get(LANG_COOKIE)))('Languages saved.') };
  }
};
