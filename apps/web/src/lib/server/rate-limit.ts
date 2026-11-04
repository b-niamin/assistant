/** Fixed-window limiter for login attempts, per client IP. In memory: a restart resets it. */
export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; start: number }>();
  return {
    /** Records an attempt; returns false when the key is over the limit. */
    attempt(key: string): boolean {
      const t = now();
      const h = hits.get(key);
      if (!h || t - h.start >= windowMs) {
        hits.set(key, { count: 1, start: t });
        return true;
      }
      h.count++;
      return h.count <= limit;
    },
    reset(key: string): void {
      hits.delete(key);
    }
  };
}
