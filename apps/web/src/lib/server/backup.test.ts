import { describe, expect, it } from 'vitest';
import { parseBackupStatus } from './backup';

describe('backup status', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  it('reads the status the backup service writes', () => {
    const s = parseBackupStatus('{"status":"ok","at":"2026-11-12T02:00:00Z","message":"ok","lastOk":"2026-11-12T02:00:00Z","lastName":"beni-2026-11-12_0300","count":9,"hour":3}', now);
    expect(s).toMatchObject({ status: 'ok', lastName: 'beni-2026-11-12_0300', count: 9, stale: false });
  });
  it('calls a backup older than 36 hours, or none, stale', () => {
    expect(parseBackupStatus('{"status":"failed","at":"x","message":"dump failed","lastOk":"2026-11-10T02:00:00Z","count":3}', now)?.stale).toBe(true);
    expect(parseBackupStatus('{"status":"failed","message":"x","lastOk":""}', now)?.stale).toBe(true);
  });
  it('ignores what it does not understand', () => {
    expect(parseBackupStatus('nope')).toBe(null);
    expect(parseBackupStatus('{"status":"weird"}')).toBe(null);
  });
});
