/**
 * Status files in /logs the app shows: the backup service's (db/backup.sh: backup-status.json, and the
 * "Back up now" request it picks up within a minute, backup-request) and the last build's.
 */
import path from 'node:path';
import { jsonObject, readStatus, readText, text, writeAtomic } from './status-files';

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
  const j = jsonObject(raw);
  if (!j || !['ok', 'failed', 'running'].includes(j.status as string)) return null;
  const s = text;
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
  return readStatus(path.join(dir, 'backup-status.json'), parseBackupStatus);
}

export async function requestBackup(dir = LOGS()): Promise<void> {
  await writeAtomic(path.join(dir, 'backup-request'), `${new Date().toISOString()}\n`);
}

/** The last build of the app by live-reload (scripts/live-reload.mjs): a failed one keeps the old build serving. */
export async function buildStatus(dir = LOGS()): Promise<{ status: 'ok' | 'failed'; message: string; at: string } | null> {
  const j = jsonObject(await readText(path.join(dir, 'web-build-status.json')));
  if (j?.status !== 'ok' && j?.status !== 'failed') return null;
  return { status: j.status, message: String(j.message ?? '').slice(0, 200), at: String(j.at ?? '').slice(0, 40) };
}
