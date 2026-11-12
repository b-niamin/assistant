/**
 * System settings -> Worker (spec 002, "Background work"): the container that runs the extensions'
 * services and scheduled jobs. What it can reach on this machine, who uses what, every service and
 * scheduled run with its state and last log lines; restart a service, run a job now. Unlock first.
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { localizeExtension, tFor } from '#lib/i18n/index.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';
import { requestWorker, unitLog, workerAlive, workerStatus } from '#lib/server/worker.ts';

const LOG_LINES = 12;

export const load: PageServerLoad = async ({ cookies, locals }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=worker');
  const [status, all] = await Promise.all([workerStatus(), allExtensions()]);
  const names: Record<string, string> = {};
  for (const e of all) names[e.id] = localizeExtension(e, locals.lang).name;
  const logs: Record<string, string[]> = {};
  for (const u of status?.units ?? []) logs[u.key] = await unitLog(u.log, LOG_LINES);
  return { status, alive: workerAlive(status), names, logs };
};

const guard = async (cookies: { get(n: string): string | undefined }) => isElevated(cookies.get(SESSION_COOKIE));

async function ask(action: 'restart' | 'run', request: Request, cookies: { get(n: string): string | undefined }, lang: string) {
  const t = tFor(lang);
  if (!(await guard(cookies))) return fail(403, { error: t('Unlock first.') });
  const unit = String((await request.formData()).get('unit') ?? '');
  const status = await workerStatus();
  const u = status?.units.find((x) => x.key === unit);
  if (!u || u.kind !== (action === 'restart' ? 'service' : 'job')) return fail(404, { error: t('The worker does not run that.') });
  if (!workerAlive(status)) return fail(409, { error: t('The worker is not running, so it cannot take requests.') });
  await requestWorker(action, unit);
  console.log(`[settings] ${new Date().toISOString()} worker: ${action} ${unit}`);
  return { ok: action === 'restart' ? t('Restarting {unit}: it takes a few seconds.', { unit }) : t('{unit} starts within a few seconds.', { unit }) };
}

export const actions: Actions = {
  restart: async ({ request, cookies, locals }) => ask('restart', request, cookies, locals.lang),
  run: async ({ request, cookies, locals }) => ask('run', request, cookies, locals.lang)
};
