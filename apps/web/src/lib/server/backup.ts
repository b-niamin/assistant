/**
 * Status files in /logs the app shows: the backup service's (db/backup.sh: backup-status.json, and the
 * "Back up now" request it picks up within a minute, backup-request) and the last build's.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface BackupStatus {
  status: 'ok' | 'failed' | 'running';
  at: string;
  message: string;
  lastOk: string;
  lastName: string;
  count: number;
  hour: number;
  /** The last good backup is older than 36 hours (or there is none). */
  stale: boolean;
}

const LOGS = () => path.dirname(process.env.UPDATER_STATUS_FILE ?? '/logs/updater-status.json');
const STALE_MS = 36 * 3600 * 1000;

export function parseBackupStatus(raw: string, now = Date.now()): BackupStatus | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || !['ok', 'failed', 'running'].includes(j.status as string)) return null;
  const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const lastOk = s(j.lastOk, 40);
  const t = Date.parse(lastOk);
  return {
    status: j.status as BackupStatus['status'],
    at: s(j.at, 40),
    message: s(j.message),
    lastOk,
    lastName: s(j.lastName, 80),
    count: Number.isFinite(j.count) ? Number(j.count) : 0,
    hour: Number.isFinite(j.hour) ? Number(j.hour) : 3,
    stale: !Number.isFinite(t) || now - t > STALE_MS
  };
}

export async function backupStatus(dir = LOGS()): Promise<BackupStatus | null> {
  return parseBackupStatus(await readFile(path.join(dir, 'backup-status.json'), 'utf8').catch(() => ''));
}

export async function requestBackup(dir = LOGS()): Promise<void> {
  const target = path.join(dir, 'backup-request');
  await writeFile(`${target}.tmp`, `${new Date().toISOString()}\n`, { mode: 0o644 });
  await rename(`${target}.tmp`, target);
}

/** The last build of the app by live-reload (scripts/live-reload.mjs): a failed one keeps the old build serving. */
export async function buildStatus(dir = LOGS()): Promise<{ status: 'ok' | 'failed'; message: string; at: string } | null> {
  try {
    const j = JSON.parse(await readFile(path.join(dir, 'web-build-status.json'), 'utf8'));
    if (j?.status !== 'ok' && j?.status !== 'failed') return null;
    return { status: j.status, message: String(j.message ?? '').slice(0, 200), at: String(j.at ?? '').slice(0, 40) };
  } catch {
    return null;
  }
}
