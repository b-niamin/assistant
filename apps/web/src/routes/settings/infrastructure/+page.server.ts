/**
 * System settings -> Infrastructure: the parts of this server on one diagram, how they depend on each
 * other, the state of each, a way to its settings and, where the host's updater can do it, a restart.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension, tFor } from '#lib/i18n/index.ts';
import type { AppInfo } from '#lib/settings/infrastructure.ts';
import { observe, partStates, requestServiceRestart, serviceRestart } from '#lib/server/infrastructure.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { isStale } from '#lib/server/updater.ts';

export const load: PageServerLoad = async ({ cookies, depends, locals }) => {
  depends('app:infrastructure');
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=infrastructure');
  const [o, all] = await Promise.all([observe(), allExtensions().catch(() => [])]);
  // The installed apps, read live from the registry and the worker: core names none of them.
  const units = o.worker?.units ?? [];
  const apps: AppInfo[] = all.map((e) => {
    const l = localizeExtension(e, locals.lang);
    const own = units.filter((u) => u.ext === e.id);
    return {
      id: e.id,
      name: l.name,
      description: l.description,
      version: e.version,
      kind: e.kind,
      href: e.href,
      enabled: e.enabled,
      units: own.length,
      failed: own.filter((u) => u.state === 'failed' || u.state === 'backoff').length
    };
  });
  return {
    apps,
    states: partStates(o),
    restart: serviceRestart(o.control, o.updater),
    // Restarts go through the host's updater: without one running, the buttons would only wait.
    updaterRuns: !!o.updater && !isStale(o.updater),
    terminal: { claude: o.terminal.claude, codex: o.terminal.codex, gh: o.terminal.gh },
    deployedSha: o.updater?.deployedSha.slice(0, 7) ?? ''
  };
};

export const actions: Actions = {
  /** Restart one part: a request the host's updater takes within a minute. */
  restart: async ({ request, cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    const service = String((await request.formData()).get('service') ?? '');
    if (!(await requestServiceRestart(service))) return fail(400, { error: t('The app cannot restart that.') });
    return { ok: t('Restart requested: it starts within a minute.') };
  }
};
