/**
 * First-run wizard, step 2: the ready-made apps. The web process cannot write extensions/, so the picked
 * ones are installed by `ext install` in the dock's terminal (unlocked since step 1); the page follows
 * /settings/extensions/installed.json until they are in.
 */
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension } from '#lib/i18n/index.ts';
import { catalog, localizeEntry } from '#lib/server/catalog.ts';
import { sidecarsConfigured } from '#lib/server/sidecars.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies, locals }) => {
  const [installed, cat, unlocked] = await Promise.all([allExtensions(), catalog(), isElevated(cookies.get(SESSION_COOKIE))]);
  return {
    installed: installed.map((e) => localizeExtension(e, locals.lang)).map((e) => ({ id: e.id, name: e.name })),
    catalog: { ...cat, extensions: cat.extensions.map((e) => localizeEntry(e, locals.lang)) },
    terminal: sidecarsConfigured(),
    unlocked
  };
};
