import { reducedMotion } from './motion';

/**
 * Svelte action: counts an integer up from zero on first paint. The server-rendered text is the
 * final value, so without JS (or with reduced motion) nothing changes. It writes into the existing text
 * node (Svelte keeps updating that one), formats the steps like the page (thousands separators), and
 * ends on the exact text it started with; a new value stops it and shows as Svelte renders it.
 */
export function countUp(node: HTMLElement, value: number | null) {
  if (value == null || !Number.isFinite(value)) return;
  if (reducedMotion()) return;
  const text = node.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE) return;
  const final = (text as Text).data;
  const fmt = new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: 0 });
  const target = Math.round(value);
  const start = performance.now();
  const ms = 900;
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    (text as Text).data = k < 1 ? fmt.format(Math.round(target * eased)) : final;
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // A new value: Svelte writes its text into the same node; only the counting has to stop.
  const stop = () => cancelAnimationFrame(raf);
  return { update: stop, destroy: stop };
}
