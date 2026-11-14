import type { LayoutServerLoad } from './$types';
import { extensionsFor } from '#lib/extensions/registry.server.ts';
import { languageInfo, localizeExtension } from '#lib/i18n/index.ts';
import { languageSettings } from '#lib/server/languages.ts';
import { listProfiles } from '#lib/server/session.ts';

// Same name as TERMINAL_COOKIE in lib/user-menu/prefs.ts (a browser module, which imports the dock).
const TERMINAL_COOKIE = 'terminal';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const lang = locals.lang;
  // The languages the user menu offers (System settings -> Language).
  const languages = (await languageSettings()).enabled.map((code) => ({ code, name: languageInfo(code).name }));
  if (!locals.authenticated)
    return { authenticated: false, profiles: [], profileId: locals.profileId, theme: locals.theme, lang, languages, terminal: false, extensions: [] };
  return {
    authenticated: true,
    profiles: await listProfiles(),
    profileId: locals.profileId,
    theme: locals.theme,
    lang,
    languages,
    terminal: cookies.get(TERMINAL_COOKIE) === 'on',
    extensions: (await extensionsFor(locals.profileId)).map((e) => localizeExtension(e, lang))
  };
};
