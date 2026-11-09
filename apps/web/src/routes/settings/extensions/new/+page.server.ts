/**
 * "Extend the system": install a ready-made extension from the extensions repo (`ext install`, run in the
 * dock's terminal), hand one of its inspirations to Claude or Codex to build, or describe your own (add-extension
 * skill). Nothing is installed from the web process itself: it has no write access to extensions/.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { catalog } from '#lib/server/catalog.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=extensions/new');
  const [extensions, cat] = await Promise.all([allExtensions(), catalog()]);
  return {
    installed: extensions.map((e) => ({ id: e.id, name: e.name, href: e.href })),
    catalog: cat
  };
};
