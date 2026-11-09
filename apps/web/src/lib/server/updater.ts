/**
 * The host's updater (scripts/update.sh, spec 006). It writes /logs/updater-status.json in the shared
 * `logs` volume, and a timestamp to /logs/updater-heartbeat on every run and every 15 s while an update
 * runs; this reads them, and writes the app's requests to /logs/updater-control.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface UpdaterStatus {
  status: 'ok' | 'failed' | 'blocked' | 'updating' | 'available';
  message: string;
  actions: string;
  sha: string;
  deployedSha: string;
  deployedAt: string;
  at: string;
  branch: string;
  /** Last tick (heartbeat), '' when the updater never wrote one (older updaters, or none running). */
  checkedAt: string;
  /** While updating: step n of steps (0 when unknown) and when the deploy started. */
  step: number;
  steps: number;
  startedAt: string;
  /** Which try of this update (2+ = resumed after an interruption). */
  attempt: number;
  /** The app's last request the updater took ('' when none, or an older updater). */
  request: string;
  /** Services that still run the previous version until a confirmed restart ("claude"), '' when none. */
  pendingRestart: string;
  /** The app's last "Restart now" the updater took. */
  restartRequest: string;
}

const STATUSES = new Set(['ok', 'failed', 'blocked', 'updating', 'available']);
/** The updater ticks every 5 minutes: no sign of life for this long means its schedule does not run. */
export const STALE_MS = 20 * 60_000;
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);

/** Parses the status file; null when it is missing or not what the updater writes. */
export function parseUpdaterStatus(raw: string): UpdaterStatus | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || !STATUSES.has(j.status as string)) return null;
  return {
    status: j.status as UpdaterStatus['status'],
    message: text(j.message),
    actions: text(j.actions),
    sha: text(j.sha, 40),
    deployedSha: text(j.deployedSha, 40),
    deployedAt: text(j.deployedAt, 40),
    at: text(j.at, 40),
    branch: text(j.branch, 100),
    checkedAt: '',
    step: count(j.step),
    steps: count(j.steps),
    startedAt: text(j.startedAt, 40),
    attempt: count(j.attempt),
    request: text(j.request, 64),
    pendingRestart: text(j.pendingRestart, 200),
    restartRequest: text(j.restartRequest, 64)
  };
}

/** The updater's last sign of life (a tick or a status change), in ms; 0 when unknown. */
export function lastSeen(s: UpdaterStatus): number {
  return Math.max(Date.parse(s.checkedAt) || 0, Date.parse(s.at) || 0);
}

/** True when the updater has not shown a sign of life for STALE_MS (a long build counts as alive). */
export const isStale = (s: UpdaterStatus, now = Date.now()): boolean => s.status !== 'updating' && now - lastSeen(s) > STALE_MS;

/** A running update beats every 15 s (a minute without root): this long without one, its process died. */
export const STALLED_MS = 3 * 60_000;
/** A request the updater has not taken this long after the click: its schedule probably does not run. */
export const UNANSWERED_MS = 3 * 60_000;

export type UpdateState = 'stale' | 'interrupted' | 'updating' | 'available' | 'ok' | 'failed' | 'blocked';

/**
 * What the Updates panel and the dock show. `interrupted`: the status still says updating, but no
 * heartbeat came for STALLED_MS (a reboot, or the process was killed): the updater's next run resumes it.
 * `pending`: "Update now" was clicked and the updater has not taken it yet.
 */
export function updateView(
  s: UpdaterStatus,
  c: UpdaterControl,
  now = Date.now()
): { state: UpdateState; pending: boolean; unanswered: boolean; restartPending: boolean } {
  let state: UpdateState = s.status;
  if (s.status === 'updating') {
    if (now - lastSeen(s) > STALLED_MS) state = 'interrupted';
  } else if (isStale(s, now)) state = 'stale';
  // The updater echoes the request it took; older ones did not, so compare times for them.
  const pending = !!c.request && c.request !== s.request && (!!s.request || Date.parse(c.request) > Date.parse(s.at));
  const restartPending = !!c.restart && c.restart !== s.restartRequest;
  const unanswered = (pending && now - Date.parse(c.request) > UNANSWERED_MS) || (restartPending && now - Date.parse(c.restart ?? '') > UNANSWERED_MS);
  return { state, pending, unanswered, restartPending };
}

export async function updaterStatus(file = process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json'): Promise<UpdaterStatus | null> {
  try {
    const s = parseUpdaterStatus(await readFile(file, 'utf8'));
    if (s) s.checkedAt = (await readFile(path.join(path.dirname(file), 'updater-heartbeat'), 'utf8').catch(() => '')).trim().slice(0, 40);
    return s;
  } catch {
    return null;
  }
}

/**
 * The app's side of updating (spec 006): `mode=auto|manual` and, after "Update now", `request=<id>`, in
 * /logs/updater-control. The host's updater reads it on its next tick; it never runs anything from it.
 */
export interface UpdaterControl {
  mode: 'auto' | 'manual';
  /** When "Update now" was last clicked (ISO), '' if never. */
  request: string;
  /** When "Cancel" was last clicked during an update (ISO), '' if never. */
  cancel?: string;
  /** Restarts of claude and terminal (they end the sessions in them): asked for first (default) or automatic. */
  restarts?: 'ask' | 'auto';
  /** When "Restart now" was last clicked (ISO), '' if never. */
  restart?: string;
}

const controlFile = (statusFile: string) => path.join(path.dirname(statusFile), 'updater-control');
const STATUS_FILE = () => process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json';

export function parseControl(raw: string): UpdaterControl {
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const id = (v: string) => (/^[A-Za-z0-9:._-]{1,64}$/.test(v) ? v : '');
  return {
    mode: get('mode') === 'manual' ? 'manual' : 'auto',
    request: id(get('request')),
    cancel: id(get('cancel')),
    restarts: get('restarts') === 'auto' ? 'auto' : 'ask',
    restart: id(get('restart'))
  };
}

export async function updaterControl(file = STATUS_FILE()): Promise<UpdaterControl> {
  return parseControl(await readFile(controlFile(file), 'utf8').catch(() => ''));
}

export async function setUpdaterControl(c: UpdaterControl, file = STATUS_FILE()): Promise<void> {
  const target = controlFile(file);
  const lines = [
    `mode=${c.mode}`,
    `restarts=${c.restarts ?? 'ask'}`,
    c.request && `request=${c.request}`,
    c.cancel && `cancel=${c.cancel}`,
    c.restart && `restart=${c.restart}`
  ].filter(Boolean);
  await writeFile(`${target}.tmp`, `${lines.join('\n')}\n`, { mode: 0o644 });
  await rename(`${target}.tmp`, target);
}

/** The last lines of the running (or last) deploy's build output, /logs/updater-build.log. */
export async function buildTail(lines = 12, file = STATUS_FILE()): Promise<string[]> {
  const raw = await readFile(path.join(path.dirname(file), 'updater-build.log'), 'utf8').catch(() => '');
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/).map((l) => l.trimEnd()).filter(Boolean).slice(-lines);
}
