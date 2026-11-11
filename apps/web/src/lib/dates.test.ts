import { describe, expect, it } from 'vitest';
import { dayIn } from './dates';

describe('days in a time zone', () => {
  it('is the local day, not the UTC one', () => {
    const lateUtc = new Date('2026-11-11T23:30:00Z'); // 00:30 on the 12th in Warsaw
    expect(dayIn(lateUtc, 'Europe/Warsaw')).toBe('2026-11-12');
    expect(dayIn(lateUtc, 'UTC')).toBe('2026-11-11');
    expect(dayIn(new Date('2026-07-01T22:30:00Z'), 'Europe/Warsaw')).toBe('2026-07-02');
  });
});
