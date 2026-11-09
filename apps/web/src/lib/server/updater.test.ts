import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { isStale, parseControl, parseUpdaterStatus, setUpdaterControl, updateView, updaterControl, updaterStatus } from './updater';

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

it('reads what update.sh writes', () => {
  expect(parseUpdaterStatus(JSON.stringify(sample))).toEqual({ ...sample, checkedAt: '', step: 0, steps: 0, startedAt: '', attempt: 0, request: '' });
  expect(parseUpdaterStatus(JSON.stringify({ ...sample, attempt: 2, request: 'r1', pid: 5 }))).toMatchObject({ attempt: 2, request: 'r1' });
  expect(parseUpdaterStatus(JSON.stringify({ ...sample, status: 'updating', step: 2, steps: 5, startedAt: 'x' }))).toMatchObject({ step: 2, steps: 5 });
  expect(parseUpdaterStatus(JSON.stringify({ ...sample, step: -1, steps: '9' }))).toMatchObject({ step: 0, steps: 0 });
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
  expect(await updaterControl(file)).toEqual({ mode: 'auto', request: '', cancel: '' });
  await setUpdaterControl({ mode: 'manual', request: '2026-11-09T15:30:00.000Z', cancel: '2026-11-09T15:40:00.000Z' }, file);
  expect(await updaterControl(file)).toEqual({ mode: 'manual', request: '2026-11-09T15:30:00.000Z', cancel: '2026-11-09T15:40:00.000Z' });
  expect(parseControl('mode=manual\nrequest=$(reboot)\n')).toEqual({ mode: 'manual', request: '', cancel: '' });
});

it('tells a running update from one whose process died, and a request not taken yet', () => {
  const t = (iso: string) => Date.parse(iso);
  const u = { ...parseUpdaterStatus(JSON.stringify({ ...sample, status: 'updating', step: 2, steps: 5 }))!, checkedAt: '2026-11-06T20:01:00Z' };
  const auto = { mode: 'auto' as const, request: '' };
  expect(updateView(u, auto, t('2026-11-06T20:02:00Z')).state).toBe('updating');
  // A long build beats every 15 s: still updating after an hour as long as the beats come.
  expect(updateView({ ...u, checkedAt: '2026-11-06T21:00:00Z' }, auto, t('2026-11-06T21:00:30Z')).state).toBe('updating');
  expect(updateView(u, auto, t('2026-11-06T20:05:00Z')).state).toBe('interrupted');
  expect(updateView({ ...u, status: 'ok' }, auto, t('2026-11-06T20:05:00Z')).state).toBe('ok');
  expect(updateView({ ...u, status: 'ok' }, auto, t('2026-11-06T21:00:00Z')).state).toBe('stale');

  const ok = { ...u, status: 'ok' as const, at: '2026-11-06T20:00:00Z', checkedAt: '2026-11-06T20:10:00Z' };
  const asked = { mode: 'manual' as const, request: '2026-11-06T20:09:00.000Z' };
  expect(updateView(ok, asked, t('2026-11-06T20:10:00Z'))).toMatchObject({ pending: true, unanswered: false });
  expect(updateView(ok, asked, t('2026-11-06T20:13:00Z'))).toMatchObject({ pending: true, unanswered: true });
  expect(updateView({ ...ok, request: asked.request }, asked, t('2026-11-06T20:13:00Z')).pending).toBe(false);
  // An older updater (no request echo): taken when its status is newer than the click.
  expect(updateView({ ...ok, at: '2026-11-06T20:09:30Z' }, asked, t('2026-11-06T20:10:00Z')).pending).toBe(false);
});
