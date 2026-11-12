/** First-run wizard, the end: what is set up, and where each thing lives from now on. */
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension } from '#lib/i18n/index.ts';
import { updaterControl } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ locals }) => {
  const [apps, control] = await Promise.all([allExtensions(), updaterControl()]);
  return {
    apps: apps.map((e) => localizeExtension(e, locals.lang)).map((e) => ({ id: e.id, name: e.name, href: e.href })),
    mode: control.mode,
    funnel: control.funnel ?? 'off'
  };
};
