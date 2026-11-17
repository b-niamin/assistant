/** The decisions behind pull to refresh (PullRefresh), kept pure so they can be tested without a browser. */

/** How far (in px, after damping) the indicator must come down before letting go refreshes the page. */
export const PULL_THRESHOLD = 72;
/** The indicator never travels further than this. */
export const PULL_MAX = 120;

/**
 * The indicator's travel for a finger that moved `dy` px down from where it touched: it follows the finger and
 * slows down the closer it gets to PULL_MAX, the rubber band of iOS. About 110 px of finger arms it.
 */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return PULL_MAX * (1 - Math.exp(-dy / PULL_MAX));
}

/** Letting go at this travel refreshes. */
export function armed(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}
