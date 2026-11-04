/**
 * Last result of the host's auto-update (scripts/auto-update.sh, spec 006). The updater writes
 * /logs/updater-status.json in the shared `logs` volume; this only reads it.
 */
import { readFile } from 'node:fs/promises';

export interface UpdaterStatus {
  status: 'ok' | 'failed' | 'blocked';
  message: string;
  actions: string;
  sha: string;
  deployedSha: string;
  deployedAt: string;
  at: string;
  branch: string;
}

const STATUSES = new Set(['ok', 'failed', 'blocked']);
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
    branch: text(j.branch, 100)
  };
}

export async function updaterStatus(file = process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json'): Promise<UpdaterStatus | null> {
  try {
    return parseUpdaterStatus(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
