/**
 * "Extend the system": install a ready-made extension from the extensions repo (`ext install`, run in the
 * dock's terminal), or hand one of its inspirations to Claude to build. For an idea of your own the page points
 * to Claude or Codex in the terminal (whichever is signed in). Nothing is installed from the web process itself:
 * it has no write access to extensions/.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { catalog, localizeEntry } from '#lib/server/catalog.ts';
import { localizeExtension } from '#lib/i18n/index.ts';
import { terminalStatus } from '#lib/server/sidecars.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=extensions/new');
  const [extensions, cat, status] = await Promise.all([allExtensions(), catalog(), terminalStatus()]);
  return {
    installed: extensions.map((e) => localizeExtension(e, locals.lang)).map((e) => ({ id: e.id, name: e.name, href: e.href })),
    // Names and descriptions in the page's language where the catalog has them (spec 007).
    catalog: {
      ...cat,
      extensions: cat.extensions.map((e) => localizeEntry(e, locals.lang)),
      inspirations: cat.inspirations.map((e) => localizeEntry(e, locals.lang))
    },
    agents: { claude: status.claude, codex: status.codex }
  };
};
