import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { lineTime, mergeLogs, parseLog, readLogs } from './logs';

it('reads ISO and Python timestamps', () => {
  expect(lineTime('[live-reload] 2026-11-09T13:38:45.128Z build ok')).toBe(Date.parse('2026-11-09T13:38:45.128Z'));
  expect(lineTime('2026-11-09T13:38:45Z deployed')).toBe(Date.parse('2026-11-09T13:38:45Z'));
  expect(lineTime('2026-11-09 12:56:07,448 INFO garmin-sync')).toBe(Date.parse('2026-11-09T12:56:07.448'));
  expect(lineTime('✔ done')).toBe(0);
});

it('gives untimed lines the time above them and strips colours', () => {
  const lines = parseLog('web.log', 'first\n[x] 2026-11-09T10:00:00Z start\n\x1b[32m✔ done\x1b[0m\n\n');
  expect(lines.map((l) => [l.at, l.text])).toEqual([
    [0, 'first'],
    [Date.parse('2026-11-09T10:00:00Z'), '[x] 2026-11-09T10:00:00Z start'],
    [Date.parse('2026-11-09T10:00:00Z'), '✔ done']
  ]);
});

it('merges files by time and keeps the newest', () => {
  const a = parseLog('a.log', '2026-11-09T10:00:00Z a1\n2026-11-09T10:02:00Z a2');
  const b = parseLog('b.log', '2026-11-09T10:01:00Z b1\nb1 more\n2026-11-09T10:03:00Z b2');
  expect(mergeLogs([a, b], 10).map((l) => l.text.slice(-4))).toEqual(['Z a1', 'Z b1', 'more', 'Z a2', 'Z b2']);
  expect(mergeLogs([a, b], 2).map((l) => l.text.slice(-2))).toEqual(['a2', 'b2']);
});

it('reads only *.log files of the directory', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logs-'));
  writeFileSync(path.join(dir, 'web.log'), 'hello\n');
  writeFileSync(path.join(dir, 'updater-status.json'), '{}');
  const r = await readLogs(dir);
  expect(r.files).toEqual(['web.log']);
  expect(r.lines['web.log'][0].text).toBe('hello');
});

it('adds the worker logs (one per extension service or job)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'logs-'));
  const worker = mkdtempSync(path.join(tmpdir(), 'worker-logs-'));
  writeFileSync(path.join(dir, 'web.log'), '2026-11-09T10:00:00Z web\n');
  writeFileSync(path.join(worker, 'monitor.collector.log'), '2026-11-09T10:01:00Z sampled\n');
  const r = await readLogs(dir, worker);
  expect(r.files).toEqual(['monitor.collector.log', 'web.log']);
  expect(r.lines['monitor.collector.log'][0].text).toMatch(/sampled/);
});
