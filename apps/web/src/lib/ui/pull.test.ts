import { describe, expect, it } from 'vitest';
import { armed, pullDistance, PULL_MAX, PULL_THRESHOLD } from './pull';

describe('pull to refresh', () => {
  it('does not move for an upward or no movement', () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
  });

  it('follows the finger more slowly the further it goes, never past the maximum', () => {
    const a = pullDistance(40);
    const b = pullDistance(80);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(40);
    expect(b - a).toBeLessThan(a);
    expect(pullDistance(10_000)).toBeLessThanOrEqual(PULL_MAX);
  });

  it('arms after a deliberate pull, not a small one', () => {
    expect(armed(pullDistance(60))).toBe(false);
    expect(armed(pullDistance(200))).toBe(true);
    expect(armed(PULL_THRESHOLD)).toBe(true);
  });
});
