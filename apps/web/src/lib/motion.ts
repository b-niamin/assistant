/** Less motion: the system's setting, or "Reduce motion" in the user menu (data-motion on <html>). */
export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
