import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseUpdaterStatus, updaterStatus } from './updater';

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
  expect(parseUpdaterStatus(JSON.stringify(sample))).toEqual(sample);
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
