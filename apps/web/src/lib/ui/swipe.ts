/** The decisions behind a horizontal swipe (Pager), kept pure so they can be tested without a browser. */

/** Pixels a finger moves before the gesture picks an axis. */
export const AXIS_SLOP = 10;

/**
 * Which way a gesture goes once it moved far enough: 'x' (a swipe), 'y' (the page scrolls, the swipe
 * lets go for good) or null (too little movement to tell). A gesture counts as a swipe only when it is
 * clearly more sideways than up or down, so scrolling past the element is never caught.
 */
export function axisOf(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_SLOP) return null;
  return ax > ay * 1.2 ? 'x' : 'y';
}

/**
 * Where a finished swipe goes: a finger moving left (dx < 0) shows the next page, right the previous one.
 * It counts past a quarter of the width (at most 80 px), or as a quick flick of 30 px or more.
 */
export function swipeResult(dx: number, ms: number, width: number): 'next' | 'prev' | null {
  const far = Math.abs(dx) >= Math.min(80, width / 4);
  const flick = Math.abs(dx) >= 30 && Math.abs(dx) / Math.max(ms, 1) > 0.5;
  if (!far && !flick) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** The offset shown while dragging: follows the finger, but only a third as far towards a page that is not there. */
export function dragOffset(dx: number, hasPrev: boolean, hasNext: boolean): number {
  return (dx > 0 && !hasPrev) || (dx < 0 && !hasNext) ? dx / 3 : dx;
}
