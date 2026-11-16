/**
 * The live state of every part of this server (System settings -> Infrastructure), from what the app can
 * see without the Docker socket: the status files the updater, the worker and the backups write, a
 * question to the database, the terminal's and the browser's own answers. And the restart of one part,
 * which only the host's updater can do (spec 006, `restart-service=<service>@<id>` in its control file).
 */
import path from 'node:path';
import { backupStatus, buildStatus, type BackupStatus } from './backup.ts';
import { db } from './db.ts';
import { browserReachable, sidecarsConfigured, terminalStatus, type LoginStatus } from './sidecars.ts';
import { readText } from './status-files.ts';
import {
  funnelStatus,
  setUpdaterControl,
  updateView,
  updaterControl,
  updaterStatus,
  UNANSWERED_MS,
  type FunnelStatus,
  type UpdaterControl,
  type UpdaterStatus
} from './updater.ts';
import { workerAlive, workerStatus, type WorkerStatus } from './worker.ts';
import { PARTS, type PartId, type PartState } from '#lib/settings/infrastructure.ts';

export interface Observed {
  updater: UpdaterStatus | null;
  control: UpdaterControl;
  funnel: FunnelStatus | null;
  backup: BackupStatus | null;
  worker: WorkerStatus | null;
  build: { status: 'ok' | 'failed'; message: string } | null;
  terminal: LoginStatus & { configured: boolean };
  browser: boolean;
  database: boolean;
  /** The last lines of /logs/ext-migrate.log ('' when there is none). */
  migrateLog: string;
}

/** A restart of one part asked in the app: waiting for the updater, done, or failed. */
export interface ServiceRestart {
  service: string;
  at: string;
  state: 'pending' | 'unanswered' | 'ok' | 'failed';
}

export function serviceRestart(c: UpdaterControl, s: UpdaterStatus | null, now = Date.now()): ServiceRestart | null {
  if (!c.service) return null;
  const [service, at] = [c.service.slice(0, c.service.indexOf('@')), c.service.slice(c.service.indexOf('@') + 1)];
  if (s?.serviceRestart === c.service) return { service, at, state: s.serviceRestartResult === 'ok' ? 'ok' : 'failed' };
  return { service, at, state: now - (Date.parse(at) || now) > UNANSWERED_MS ? 'unanswered' : 'pending' };
}

/** Each part's health and the state the page puts in words. Pure: the tests feed it what was observed. */
export function partStates(o: Observed, now = Date.now()): Record<PartId, PartState> {
  const s = (health: PartState['health'], state: string, detail = ''): PartState => ({ health, state, detail });
  const held = (o.updater?.pendingRestart ?? '').split(' ').filter(Boolean);
  const out = {} as Record<PartId, PartState>;

  out.you = s('good', 'here');

  const want = o.control.funnel === 'on';
  const fstate = !want ? 'off' : o.funnel?.state === 'on' && o.funnel.url ? 'on' : o.funnel?.state === 'error' || o.funnel?.state === 'unavailable' ? 'error' : 'turning';
  out.connector = s(fstate === 'on' ? 'good' : fstate === 'error' ? 'critical' : fstate === 'turning' ? 'warning' : 'off', fstate, fstate === 'error' ? (o.funnel?.message ?? '') : '');
  out.claude = s(fstate === 'on' ? 'good' : 'off', fstate === 'on' ? 'can-connect' : 'cannot-connect');

  if (!o.updater) {
    out.updater = s('off', 'none');
    out.github = s('off', 'unknown');
  } else {
    const v = updateView(o.updater, o.control, now);
    const health =
      v.state === 'stale' || v.state === 'failed'
        ? 'critical'
        : v.state === 'interrupted' || v.state === 'blocked' || v.state === 'updating' || held.length
          ? 'warning'
          : 'good';
    out.updater = s(health, v.state === 'ok' && held.length ? 'held' : v.state, v.state === 'failed' || v.state === 'blocked' ? o.updater.message : '');
    const offline = o.updater.status === 'failed' && o.updater.message.startsWith('cannot reach GitHub');
    out.github = s(offline ? 'warning' : 'good', offline ? 'unreachable' : 'main', o.updater.sha.slice(0, 7));
  }

  out.web = o.build?.status === 'failed' ? s('warning', 'build-failed', o.build.message) : s('good', 'running');
  out.db = o.database ? s('good', 'running') : s('critical', 'down');

  const t = o.terminal;
  out.terminal = !t.configured
    ? s('off', 'not-set-up')
    : !t.reachable
      ? s('critical', 'down')
      : !t.chat
        ? s('warning', 'outdated')
        : held.includes('terminal')
          ? s('warning', 'held')
          : s('good', 'running');
  out.browser = !t.configured ? s('off', 'not-set-up') : o.browser ? (held.includes('browser') ? s('warning', 'held') : s('good', 'running')) : s('critical', 'down');

  const units = o.worker?.units ?? [];
  const failed = units.filter((u) => u.state === 'failed' || u.state === 'backoff').length;
  out.worker = !o.worker
    ? s('off', 'none')
    : !workerAlive(o.worker, now)
      ? s('critical', 'down')
      : failed
        ? s('warning', 'units-failed', String(failed))
        : s('good', 'units', String(units.length));

  const b = o.backup;
  out.backup = !b
    ? s('off', 'none')
    : b.status === 'running'
      ? s('good', 'backing-up')
      : b.status === 'failed'
        ? s('critical', 'failed', b.message)
        : b.stale
          ? s('warning', 'stale')
          : s('good', 'ok');

  const lines = o.migrateLog.split('\n').filter((l) => l.startsWith('[ext-migrate]') || /fail|error/i.test(l));
  const last = lines.at(-1) ?? '';
  out['ext-migrate'] = !o.migrateLog ? s('off', 'no-status') : /fail/i.test(last) ? s('warning', 'failed', last.replace(/^\[ext-migrate\]\s*/, '')) : s('good', 'watching');

  return out;
}

const LOGS = () => path.dirname(process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json');

async function databaseUp(): Promise<boolean> {
  try {
    await Promise.race([db()`select 1`, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 2000))]);
    return true;
  } catch {
    return false;
  }
}

export async function observe(): Promise<Observed> {
  const [updater, control, funnel, backup, worker, build, terminal, browser, database, migrateLog] = await Promise.all([
    updaterStatus(),
    updaterControl(),
    funnelStatus(),
    backupStatus(),
    workerStatus(),
    buildStatus(),
    terminalStatus(),
    browserReachable(),
    databaseUp(),
    readText(path.join(LOGS(), 'ext-migrate.log')).then((raw) => raw.slice(-4000))
  ]);
  return { updater, control, funnel, backup, worker, build, terminal: { ...terminal, configured: sidecarsConfigured() }, browser, database, migrateLog };
}

/** The compose services the app may ask the updater to restart (scripts/update.sh RESTARTABLE). */
export const RESTARTABLE = new Set(PARTS.flatMap((p) => (p.service ? [p.service] : [])));

/** Asks the host's updater to restart one service; it takes it within a minute. False: not one it may restart. */
export async function requestServiceRestart(service: string): Promise<boolean> {
  if (!RESTARTABLE.has(service)) return false;
  await setUpdaterControl({ ...(await updaterControl()), service: `${service}@${new Date().toISOString()}` });
  console.log(`[settings] ${new Date().toISOString()} restart of ${service} requested`);
  return true;
}
