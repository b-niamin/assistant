/**
 * Last result of the host's auto-update (scripts/auto-update.sh, spec 006). The updater writes
 * /logs/updater-status.json in the shared `logs` volume, and a timestamp on every tick to
 * /logs/updater-heartbeat; this only reads them.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface UpdaterStatus {
  status: 'ok' | 'failed' | 'blocked' | 'updating';
  message: string;
  actions: string;
  sha: string;
  deployedSha: string;
  deployedAt: string;
  at: string;
  branch: string;
  /** Last tick (heartbeat), '' when the updater never wrote one (older updaters, or none running). */
  checkedAt: string;
}

const STATUSES = new Set(['ok', 'failed', 'blocked', 'updating']);
/** The updater ticks every 5 minutes: no sign of life for this long means its schedule does not run. */
export const STALE_MS = 20 * 60_000;
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

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
    checkedAt: ''
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
