/**
 * Last result of the host's auto-update (scripts/auto-update.sh, spec 006). The updater writes
 * /logs/updater-status.json in the shared `logs` volume, and a timestamp on every tick to
 * /logs/updater-heartbeat; this only reads them.
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
    startedAt: text(j.startedAt, 40)
  };
}

/** The updater's last sign of life (a tick or a status change), in ms; 0 when unknown. */
export function lastSeen(s: UpdaterStatus): number {
  return Math.max(Date.parse(s.checkedAt) || 0, Date.parse(s.at) || 0);
}

/** True when the updater has not shown a sign of life for STALE_MS (a long build counts as alive). */
export const isStale = (s: UpdaterStatus, now = Date.now()): boolean => s.status !== 'updating' && now - lastSeen(s) > STALE_MS;

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
}

const controlFile = (statusFile: string) => path.join(path.dirname(statusFile), 'updater-control');
const STATUS_FILE = () => process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json';

export function parseControl(raw: string): UpdaterControl {
  const get = (k: string) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const request = get('request');
  return { mode: get('mode') === 'manual' ? 'manual' : 'auto', request: /^[A-Za-z0-9:._-]{1,64}$/.test(request) ? request : '' };
}

export async function updaterControl(file = STATUS_FILE()): Promise<UpdaterControl> {
  return parseControl(await readFile(controlFile(file), 'utf8').catch(() => ''));
}

export async function setUpdaterControl(c: UpdaterControl, file = STATUS_FILE()): Promise<void> {
  const target = controlFile(file);
  await writeFile(`${target}.tmp`, `mode=${c.mode}\n${c.request ? `request=${c.request}\n` : ''}`, { mode: 0o644 });
  await rename(`${target}.tmp`, target);
}

/** The last lines of the running (or last) deploy's build output, /logs/updater-build.log. */
export async function buildTail(lines = 12, file = STATUS_FILE()): Promise<string[]> {
  const raw = await readFile(path.join(path.dirname(file), 'updater-build.log'), 'utf8').catch(() => '');
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/).map((l) => l.trimEnd()).filter(Boolean).slice(-lines);
}
