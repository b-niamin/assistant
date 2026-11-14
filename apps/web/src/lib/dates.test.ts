import { describe, expect, it } from 'vitest';
import { dayIn, instantIn, offsetIn } from './dates';

describe('days in a time zone', () => {
  it('is the local day, not the UTC one', () => {
    const lateUtc = new Date('2026-11-11T23:30:00Z'); // 00:30 on the 12th in Warsaw
    expect(dayIn(lateUtc, 'Europe/Warsaw')).toBe('2026-11-12');
    expect(dayIn(lateUtc, 'UTC')).toBe('2026-11-11');
    expect(dayIn(new Date('2026-07-01T22:30:00Z'), 'Europe/Warsaw')).toBe('2026-07-02');
  });
});

describe('wall-clock times in a time zone', () => {
  it('turns a local time into the instant', () => {
    expect(instantIn('2026-11-14', '18:30', 'Europe/Warsaw').toISOString()).toBe('2026-11-14T17:30:00.000Z');
    expect(instantIn('2026-07-01', '00:00', 'Europe/Warsaw').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(instantIn('2026-11-14', undefined, 'UTC').toISOString()).toBe('2026-11-14T00:00:00.000Z');
    expect(offsetIn(new Date('2026-11-14T12:00:00Z'), 'Europe/Warsaw')).toBe(60);
  });
  it('handles the days the clock changes', () => {
    expect(instantIn('2026-03-29', '03:30', 'Europe/Warsaw').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(instantIn('2026-10-25', '01:00', 'Europe/Warsaw').toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });
});
