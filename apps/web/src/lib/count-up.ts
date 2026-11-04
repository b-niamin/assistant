/**
 * Svelte action: counts an integer up from zero on first paint. The server-rendered text is the
 * final value, so without JS (or with reduced motion) nothing changes.
 */
export function countUp(node: HTMLElement, value: number | null) {
  if (value == null || !Number.isFinite(value)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = Math.round(value);
  const start = performance.now();
  const ms = 900;
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = String(Math.round(target * eased));
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { destroy: () => cancelAnimationFrame(raf) };
}
