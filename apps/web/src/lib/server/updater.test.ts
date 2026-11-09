import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isStale, parseControl, parseUpdaterStatus, setUpdaterControl, updaterControl, updaterStatus } from './updater';

const sample = {
  status: 'ok',
  message: 'deployed 1234567',
  actions: 'build:claude build:terminal',
  sha: '1234567890abcdef1234567890abcdef12345678',
  deployedSha: '1234567890abcdef1234567890abcdef12345678',
  deployedAt: '2026-11-06T20:00:00Z',
  at: '2026-11-06T20:00:00Z',
  branch: 'main'
};

it('reads what auto-update.sh writes', () => {
  expect(parseUpdaterStatus(JSON.stringify(sample))).toEqual({ ...sample, checkedAt: '' });
});

it('rejects junk and unknown statuses', () => {
  expect(parseUpdaterStatus('not json')).toBeNull();
  expect(parseUpdaterStatus('null')).toBeNull();
  expect(parseUpdaterStatus(JSON.stringify({ ...sample, status: 'pwned' }))).toBeNull();
  expect(parseUpdaterStatus(JSON.stringify({ ...sample, message: 5 }))?.message).toBe('');
});

it('returns null when the file is missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upd-'));
  expect(await updaterStatus(path.join(dir, 'nope.json'))).toBeNull();
  writeFileSync(path.join(dir, 's.json'), JSON.stringify(sample));
  expect((await updaterStatus(path.join(dir, 's.json')))?.status).toBe('ok');
});

it('reads the heartbeat next to the status and tells a stopped updater', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upd-'));
  writeFileSync(path.join(dir, 's.json'), JSON.stringify(sample));
  const old = (await updaterStatus(path.join(dir, 's.json')))!;
  expect(old.checkedAt).toBe('');
  expect(isStale(old, Date.parse('2026-11-06T20:30:00Z'))).toBe(true);
  writeFileSync(path.join(dir, 'updater-heartbeat'), '2026-11-06T20:25:00Z\n');
  const fresh = (await updaterStatus(path.join(dir, 's.json')))!;
  expect(fresh.checkedAt).toBe('2026-11-06T20:25:00Z');
  expect(isStale(fresh, Date.parse('2026-11-06T20:30:00Z'))).toBe(false);
  expect(isStale({ ...old, status: 'updating' }, Date.parse('2026-11-07T20:30:00Z'))).toBe(false);
});

it('keeps the manual mode and the update request for the host', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'upd-'));
  const file = path.join(dir, 'updater-status.json');
  expect(await updaterControl(file)).toEqual({ mode: 'auto', request: '' });
  await setUpdaterControl({ mode: 'manual', request: '2026-11-09T15:30:00.000Z' }, file);
  expect(await updaterControl(file)).toEqual({ mode: 'manual', request: '2026-11-09T15:30:00.000Z' });
  expect(parseControl('mode=manual\nrequest=$(reboot)\n')).toEqual({ mode: 'manual', request: '' });
});
