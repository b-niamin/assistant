import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseWorkerStatus, requestWorker, unitLog, workerAlive } from './worker';

const status = {
  version: 1,
  at: '2026-11-12T09:00:00Z',
  started_at: '2026-11-12T08:00:00Z',
  hostname: 'nas',
  database: true,
  access: [{ name: 'proc', path: '/host/proc', source: '/proc', what: 'processes', mounted: true, readonly: true, used_by: ['monitor/collector'] }],
  keys: [{ name: 'TOKEN_ENCRYPTION_KEY', what: 'logins', set: true, used_by: [] }],
  units: [
    { key: 'monitor/collector', ext: 'monitor', name: 'collector', kind: 'service', run: 'python -m collector loop', dir: 'services/collector', host: ['proc'], keys: [], env: [], uid: 61000, state: 'running', since: '2026-11-12T08:00:05Z', restarts: 0, last_exit: null, rss: 30_000_000, schedule: null, log: 'monitor.collector.log' },
    { key: 'monitor/prune', ext: 'monitor', name: 'prune', kind: 'job', run: 'python -m collector prune', state: 'idle', schedule: 'cron 15 3 * * *', timeout: '10m', next_run: '2026-11-13T03:15:00Z', last_run: { start: '2026-11-12T03:15:00Z', end: '2026-11-12T03:15:02Z', exit: 0, duration: 2 }, log: '../../etc/passwd' },
    { key: '../x', ext: 'x', name: 'x', kind: 'service' }
  ],
  external: [{ ext: 'old', name: 'old-sync' }],
  problems: [{ ext: 'bad', message: 'bad: service "x": host may only list proc, sys' }]
};

it('reads what the worker writes, and nothing it does not', () => {
  const s = parseWorkerStatus(JSON.stringify(status))!;
  expect(s.hostname).toBe('nas');
  expect(s.access[0]).toMatchObject({ readonly: true, usedBy: ['monitor/collector'] });
  expect(s.units.map((u) => u.key)).toEqual(['monitor/collector', 'monitor/prune']);
  expect(s.units[1]).toMatchObject({ kind: 'job', nextRun: '2026-11-13T03:15:00Z', lastRun: { exit: 0, duration: 2 }, log: '' });
  expect(s.external).toEqual([{ ext: 'old', name: 'old-sync' }]);
  expect(parseWorkerStatus('{"version":2}')).toBeNull();
  expect(parseWorkerStatus('nope')).toBeNull();
});

it('knows when the worker stopped writing', () => {
  const s = parseWorkerStatus(JSON.stringify(status));
  expect(workerAlive(s, Date.parse('2026-11-12T09:00:30Z'))).toBe(true);
  expect(workerAlive(s, Date.parse('2026-11-12T09:05:00Z'))).toBe(false);
  expect(workerAlive(null)).toBe(false);
});

it('tails a unit log and leaves requests for the worker', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'worker-'));
  mkdirSync(path.join(dir, 'logs'));
  mkdirSync(path.join(dir, 'control'));
  writeFileSync(path.join(dir, 'logs', 'monitor.collector.log'), Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n');
  expect(await unitLog('monitor.collector.log', 3, dir)).toEqual(['line 47', 'line 48', 'line 49']);
  expect(await unitLog('../status.json', 3, dir)).toEqual([]);
  await requestWorker('restart', 'monitor/collector', dir);
  const files = readdirSync(path.join(dir, 'control'));
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.json$/);
  expect(JSON.parse(readFileSync(path.join(dir, 'control', files[0]), 'utf8'))).toEqual({ action: 'restart', unit: 'monitor/collector' });
  await expect(requestWorker('run', '../etc', dir)).rejects.toThrow();
});
