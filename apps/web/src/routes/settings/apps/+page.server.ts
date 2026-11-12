/**
 * System settings -> Apps: every installed extension with who sees it, and the way to more
 * (/settings/extensions/new). Each app's own panel is /settings/extensions/<id>.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension } from '#lib/i18n/index.ts';
import { languageSettings } from '#lib/server/languages.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=apps');
  const [all, profiles, languages] = await Promise.all([allExtensions(), listProfiles(), languageSettings()]);
  const extensions = all.map((e) => localizeExtension(e, locals.lang));
  return {
    extensions,
    profiles,
    untranslated: extensions.filter((e) => languages.enabled.some((l) => !e.languages.includes(l))).length
  };
};
