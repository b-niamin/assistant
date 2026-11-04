<script lang="ts">
  import type { TileSeries } from '$lib/extensions/tiles';

  /**
   * The small chart inside a dashboard tile. Same rules as the health sparklines (specs/001):
   * history in the de-emphasis grey, the latest point (or bar) in the tile's hue. Line = trend glyph
   * (gaps bridged); bars = discrete buckets (gaps stay empty). Values are in the native tooltip and in
   * the accessible label, so nothing is colour-only.
   */
  let { series, height = 44 }: { series: TileSeries; height?: number } = $props();

  const P = 4;
  let W = $state(200);
  const H = $derived(height);
  const pts = $derived(series.points);
  const vals = $derived(pts.map((p) => p.value).filter((v): v is number => v !== null));
  const hue = $derived(series.hue ? `var(--hue-${series.hue})` : 'var(--accent)');
  const fmt = (v: number | null) =>
    v === null ? 'no data' : `${Number(v.toFixed(Math.abs(v) < 10 ? 1 : 0))}${series.unit ? ' ' + series.unit : ''}`;
  const summary = $derived(
    `${series.kind === 'bars' ? 'Bar chart' : 'Trend'}${series.caption ? ', ' + series.caption : ''}: ` +
      pts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')
  );

  // line
  const lmin = $derived(Math.min(...vals));
  const lspan = $derived(Math.max(...vals) - lmin || 1);
  const lx = (i: number) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P);
  const ly = (v: number) => P + (1 - (v - lmin) / lspan) * (H - 2 * P);
  const path = $derived.by(() => {
    let d = '';
    pts.forEach((p, i) => {
      if (p.value === null) return;
      d += `${d ? 'L' : 'M'}${lx(i).toFixed(1)},${ly(p.value).toFixed(1)}`;
    });
    return d;
  });
  const last = $derived(pts.findLastIndex((p) => p.value !== null));

  // bars: zero-based, so lengths compare honestly
  const bmax = $derived(Math.max(0, ...vals) || 1);
  const gap = $derived(pts.length > 20 ? 1 : 3);
  const bw = $derived(Math.max(1, (W - gap * (pts.length - 1)) / Math.max(1, pts.length)));
  const bh = (v: number | null) => (v === null || v <= 0 ? 0 : Math.max(2, (v / bmax) * (H - 2)));
</script>

<figure class="chart" style:--h="{H}px" style:--series={hue}>
  <div class="plot" bind:clientWidth={W} role="img" aria-label={summary}>
    {#if series.kind === 'bars'}
      <svg width={W} height={H} aria-hidden="true">
        <line class="base" x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} />
        {#each pts as p, i}
          {@const h = bh(p.value)}
          <rect
            class:current={i === last}
            x={i * (bw + gap)}
            y={H - 1 - h}
            width={bw}
            height={h}
            rx={Math.min(2, bw / 3)}
            style:animation-delay="{120 + i * 30}ms"
          >
            <title>{p.label}: {fmt(p.value)}</title>
          </rect>
        {/each}
      </svg>
    {:else if vals.length >= 2}
      <svg width={W} height={H} aria-hidden="true">
        <path d={path} pathLength="1" />
        <circle cx={lx(last)} cy={ly(pts[last].value!)} r="3.5"><title>{pts[last].label}: {fmt(pts[last].value)}</title></circle>
      </svg>
    {/if}
  </div>
  {#if series.caption}<figcaption>{series.caption}</figcaption>{/if}
</figure>

<style>
  .chart {
    margin: 0;
    display: grid;
    gap: var(--space-1);
  }
  .plot {
    height: var(--h);
  }
  svg {
    display: block;
    overflow: visible;
  }
  figcaption {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .base {
    stroke: var(--grid);
    stroke-width: 1;
  }
  rect {
    fill: var(--axis);
    transform-box: fill-box;
    transform-origin: bottom;
  }
  rect.current {
    fill: var(--series);
  }
  path {
    fill: none;
    stroke: var(--axis);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  circle {
    fill: var(--series);
    stroke: var(--surface);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
  }
  @media (prefers-reduced-motion: no-preference) {
    rect {
      animation: grow 520ms cubic-bezier(0.3, 1.3, 0.5, 1) both;
    }
    path {
      stroke-dasharray: 1;
      animation: draw 900ms cubic-bezier(0.65, 0, 0.35, 1) 150ms both;
    }
    circle {
      animation: pop 360ms cubic-bezier(0.3, 1.6, 0.5, 1) 950ms both;
    }
  }
  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
  }
</style>
