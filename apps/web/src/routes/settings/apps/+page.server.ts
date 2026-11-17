/**
 * System settings -> Apps: every installed extension with who sees it, and the way to more
 * (/settings/extensions/new), and "Update all" when the extensions repo has newer versions. Each app's own
 * panel is /settings/extensions/<id>.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension } from '#lib/i18n/index.ts';
import { catalog } from '#lib/server/catalog.ts';
import { extensionUpdates } from '#lib/settings/ext-updates.ts';
import { SHELL_API } from '#lib/shell-api.js';
import { languageSettings } from '#lib/server/languages.ts';
import { isElevated, listProfiles, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=apps');
  const [all, profiles, languages] = await Promise.all([allExtensions(), listProfiles(), languageSettings()]);
  const extensions = all.map((e) => localizeExtension(e, locals.lang));
  return {
    extensions,
    profiles,
    // Newer versions in the extensions repo. Streamed: the list does not wait up to 5 s for GitHub.
    updates: catalog().then((c) => extensionUpdates(extensions, c.extensions, SHELL_API)),
    untranslated: extensions.filter((e) => languages.enabled.some((l) => !e.languages.includes(l))).length
  };
};
