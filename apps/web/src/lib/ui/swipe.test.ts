import { describe, expect, it } from 'vitest';
import { axisOf, dragOffset, swipeResult } from './swipe';

describe('swipe', () => {
  it('waits for some movement before picking an axis, and leaves vertical scrolling alone', () => {
    expect(axisOf(4, 3)).toBeNull();
    expect(axisOf(-30, 5)).toBe('x');
    expect(axisOf(12, 40)).toBe('y');
    expect(axisOf(20, 19)).toBe('y');
  });

  it('pages on a long drag or a quick flick, left = next', () => {
    expect(swipeResult(-100, 600, 360)).toBe('next');
    expect(swipeResult(100, 600, 360)).toBe('prev');
    expect(swipeResult(-40, 600, 360)).toBeNull();
    expect(swipeResult(-40, 50, 360)).toBe('next');
    expect(swipeResult(20, 10, 360)).toBeNull();
    expect(swipeResult(-50, 600, 160)).toBe('next');
  });

  it('resists a drag towards a page that is not there', () => {
    expect(dragOffset(60, true, true)).toBe(60);
    expect(dragOffset(60, false, true)).toBe(20);
    expect(dragOffset(-60, true, false)).toBe(-20);
  });
});
