import { describe, expect, it } from 'vitest';
import { nextDay, normalizeEntry, rangeDays, sortEntries, toRange } from './calendar';

const tz = 'Europe/Warsaw';
// 14 Nov 2026 in Warsaw (UTC+1): 13 Nov 23:00Z .. 14 Nov 23:00Z
const day = toRange('2026-11-13T23:00:00Z', '2026-11-14T23:00:00Z', tz);
const src = { extension: 'gym', name: 'Gym Tracker' };

describe('normalizeEntry', () => {
  it('keeps a timed entry in the range, as UTC instants', () => {
    expect(normalizeEntry({ id: 1, title: ' Push ', start: '2026-11-14T18:30:00+01:00', end: '2026-11-14T19:30:00+01:00' }, day, src)).toEqual({
      id: '1',
      title: 'Push',
      allDay: false,
      start: '2026-11-14T17:30:00.000Z',
      end: '2026-11-14T18:30:00.000Z',
      source: src
    });
  });
  it('drops junk, times without a zone and entries outside the range', () => {
    expect(normalizeEntry(null, day, src)).toBeNull();
    expect(normalizeEntry({ id: 'a', start: '2026-11-14' }, day, src)).toBeNull();
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-14T10:00:00' }, day, src)).toBeNull();
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-02-30' }, day, src)).toBeNull();
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-15T00:30:00+01:00' }, day, src)).toBeNull();
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-13' }, day, src)).toBeNull();
  });
  it('keeps one that started before the range and still runs, and a zero-length one at its start', () => {
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-13T22:00:00Z', end: '2026-11-14T01:00:00Z' }, day, src)?.allDay).toBe(false);
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-13T23:00:00Z' }, day, src)?.end).toBe('2026-11-13T23:00:00.000Z');
  });
  it('gives all-day entries an exclusive end and keeps those that cover the range', () => {
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-14' }, day, src)).toMatchObject({ allDay: true, start: '2026-11-14', end: '2026-11-15' });
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-10', end: '2026-11-20' }, day, src)?.end).toBe('2026-11-20');
    expect(normalizeEntry({ id: 'a', title: 'x', start: '2026-11-14', end: '2026-11-01' }, day, src)?.end).toBe('2026-11-15');
  });
  it('clips texts and keeps a link only inside its own extension', () => {
    const e = normalizeEntry({ id: 'a', title: 't', start: '2026-11-14', note: 'n'.repeat(2000), kind: 'Workout', href: '/gym?w=1' }, day, src);
    expect(e?.note).toHaveLength(1000);
    expect(e?.href).toBe('/gym?w=1');
    expect(normalizeEntry({ id: 'a', title: 't', start: '2026-11-14', href: '/health' }, day, src)?.href).toBeUndefined();
    expect(normalizeEntry({ id: 'a', title: 't', start: '2026-11-14', href: '/gymnastics' }, day, src)?.href).toBeUndefined();
    expect(normalizeEntry({ id: 'a', title: 't', start: '2026-11-14', href: '//evil.example' }, day, src)?.href).toBeUndefined();
  });
});

describe('ranges and order', () => {
  it('counts days in the zone', () => {
    expect(rangeDays(day)).toEqual({ first: '2026-11-14', last: '2026-11-14' });
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
  it('refuses empty and huge ranges', () => {
    expect(() => toRange('2026-11-14', '2026-11-14', tz)).toThrow();
    expect(() => toRange('2026-01-01', '2027-06-01', tz)).toThrow(/400/);
  });
  it('sorts by day, all-day first, then by time', () => {
    const list = [
      { allDay: false, start: '2026-11-14T17:00:00.000Z', title: 'b' },
      { allDay: true, start: '2026-11-15', title: 'c' },
      { allDay: false, start: '2026-11-14T08:00:00.000Z', title: 'a' },
      { allDay: true, start: '2026-11-14', title: 'z' }
    ];
    expect(sortEntries(list, tz).map((e) => e.title)).toEqual(['z', 'a', 'b', 'c']);
  });
});
