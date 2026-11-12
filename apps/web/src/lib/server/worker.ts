/**
 * The worker (spec 002, "Background work"; docker/worker/worker.py): the container that runs the
 * extensions' services and scheduled jobs. It writes /worker/status.json (what it can reach on the host,
 * every unit and its state) and one log per unit in /worker/logs; the app reads them for System settings
 * -> Worker and leaves its requests (restart a service, run a job now) in /worker/control, which the
 * worker's units cannot write.
 */
import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ID_RE, UNIT_NAME_RE } from '#lib/ids.js';
import { jsonObject, readStatus, text, writeAtomic } from './status-files';

export interface WorkerAccess {
  name: string;
  path: string;
  source: string;
  what: string;
  mounted: boolean;
  readonly: boolean;
  usedBy: string[];
}

export interface WorkerKey {
  name: string;
  what: string;
  set: boolean;
  usedBy: string[];
}

export interface WorkerUnit {
  key: string;
  ext: string;
  name: string;
  kind: 'service' | 'job';
  description: string;
  run: string;
  dir: string;
  host: string[];
  keys: string[];
  env: string[];
  uid: number | null;
  /** service: starting | running | backoff | failed; job: idle | running | failed */
  state: string;
  since: string;
  restarts: number;
  lastExit: number | null;
  lastExitAt: string;
  rss: number | null;
  schedule: string;
  timeout: string;
  nextRun: string;
  lastRun: { start: string; end: string; exit: number | null; duration: number | null } | null;
  log: string;
}

export interface WorkerStatus {
  at: string;
  startedAt: string;
  hostname: string;
  database: boolean;
  access: WorkerAccess[];
  keys: WorkerKey[];
  units: WorkerUnit[];
  /** Services an extension still runs from its own compose.yml (the older way). */
  external: { ext: string; name: string }[];
  problems: { ext: string; message: string }[];
}

/** The worker writes its status every 20 s at least: older than this, it is not running. */
export const WORKER_STALE_MS = 90_000;
const DIR = () => process.env.WORKER_DIR ?? '/worker';
const ext = EXTENSION_ID_RE.source.slice(1, -1), unit = UNIT_NAME_RE.source.slice(1, -1);
const UNIT_KEY = new RegExp(`^${ext}/${unit}$`);
const LOG_NAME = new RegExp(`^${ext}\\.${unit}\\.log$`);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)) : []);
const objects = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** The status file as the page uses it; null when missing or not what the worker writes. */
export function parseWorkerStatus(raw: string): WorkerStatus | null {
  const j = jsonObject(raw);
  if (!j || j.version !== 1) return null;
  return {
    at: text(j.at, 40),
    startedAt: text(j.started_at, 40),
    hostname: text(j.hostname, 100),
    database: j.database === true,
    access: objects(j.access).map((a) => ({
      name: text(a.name, 40),
      path: text(a.path, 200),
      source: text(a.source, 200),
      what: text(a.what),
      mounted: a.mounted === true,
      readonly: a.readonly === true,
      usedBy: list(a.used_by)
    })),
    keys: objects(j.keys).map((k) => ({ name: text(k.name, 64), what: text(k.what), set: k.set === true, usedBy: list(k.used_by) })),
    units: objects(j.units)
      .filter((u) => UNIT_KEY.test(text(u.key, 100)))
      .map((u) => {
        const last = u.last_run && typeof u.last_run === 'object' ? (u.last_run as Record<string, unknown>) : null;
        return {
          key: text(u.key, 100),
          ext: text(u.ext, 60),
          name: text(u.name, 40),
          kind: u.kind === 'job' ? ('job' as const) : ('service' as const),
          description: text(u.description, 160),
          run: text(u.run, 1000),
          dir: text(u.dir, 200),
          host: list(u.host),
          keys: list(u.keys),
          env: list(u.env),
          uid: num(u.uid),
          state: text(u.state, 20),
          since: text(u.since, 40),
          restarts: num(u.restarts) ?? 0,
          lastExit: num(u.last_exit),
          lastExitAt: text(u.last_exit_at, 40),
          rss: num(u.rss),
          schedule: text(u.schedule, 100),
          timeout: text(u.timeout, 20),
          nextRun: text(u.next_run, 40),
          lastRun: last ? { start: text(last.start, 40), end: text(last.end, 40), exit: num(last.exit), duration: num(last.duration) } : null,
          log: LOG_NAME.test(text(u.log, 100)) ? text(u.log, 100) : ''
        };
      }),
    external: objects(j.external).map((e) => ({ ext: text(e.ext, 60), name: text(e.name, 60) })),
    problems: objects(j.problems).map((p) => ({ ext: text(p.ext, 60), message: text(p.message, 500) }))
  };
}

export async function workerStatus(dir = DIR()): Promise<WorkerStatus | null> {
  return readStatus(path.join(dir, 'status.json'), parseWorkerStatus);
}

/** Running: the status was written recently (the worker rewrites it every 20 s). */
export const workerAlive = (s: WorkerStatus | null, now = Date.now()) => !!s && now - Date.parse(s.at) < WORKER_STALE_MS;

/** The last `lines` lines of a unit's log. */
export async function unitLog(log: string, lines = 30, dir = DIR()): Promise<string[]> {
  if (!LOG_NAME.test(log)) return [];
  const fh = await open(path.join(dir, 'logs', log), 'r').catch(() => null);
  if (!fh) return [];
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - 32 * 1024);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const all = buf.toString('utf8').split('\n');
    if (start > 0) all.shift();
    return all.filter((l) => l.trim()).slice(-lines).map((l) => l.slice(0, 500));
  } finally {
    await fh.close();
  }
}

/** Asks the worker to restart a service or run a job now; it acts within a few seconds. */
export async function requestWorker(action: 'restart' | 'run', unit: string, dir = DIR()): Promise<void> {
  if (!UNIT_KEY.test(unit)) throw new Error('bad unit');
  const file = path.join(dir, 'control', `${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  await writeAtomic(file, JSON.stringify({ action, unit }));
}
