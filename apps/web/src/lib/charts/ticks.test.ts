import { describe, expect, it } from 'vitest';
import { byteTicks, niceTicks, runsOf, scaledTicks } from './ticks';

describe('niceTicks', () => {
  it('lands on round steps', () => {
    expect(niceTicks(46, 61)).toEqual([45, 50, 55, 60, 65]);
    expect(niceTicks(0, 14000)).toEqual([0, 5000, 10000, 15000]);
    expect(niceTicks(0, 95)).toEqual([0, 25, 50, 75, 100]);
  });
  it('widens a flat series and skips non-numbers', () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
    expect(niceTicks(NaN, 1)).toEqual([]);
  });
});

describe('byteTicks and scaledTicks', () => {
  it('round in the shown unit', () => {
    expect(byteTicks(0, 3.5 * 1024 * 1024).map((v) => v / 1024 / 1024)).toEqual([0, 1, 2, 3, 4]);
    expect(scaledTicks(5 * 3600, 8.4 * 3600, 3600).map((v) => v / 3600)).toEqual([5, 6, 7, 8, 9]);
  });
});

describe('runsOf', () => {
  it('splits at gaps', () => {
    expect(runsOf([1, 2, null, 3])).toEqual([
      [
        { i: 0, v: 1 },
        { i: 1, v: 2 }
      ],
      [{ i: 3, v: 3 }]
    ]);
    expect(runsOf([null, null])).toEqual([]);
  });
});
