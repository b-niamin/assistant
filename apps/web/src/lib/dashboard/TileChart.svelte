<script lang="ts">
  import type { TileSeries } from '#lib/extensions/tiles.ts';
  import Sparkline from '#lib/charts/Sparkline.svelte';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  /**
   * The small chart inside a dashboard tile (specs/001), the line being the shared Sparkline:
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
    v === null ? t('no data') : `${Number(v.toFixed(Math.abs(v) < 10 ? 1 : 0)).toLocaleString(t.locale)}${series.unit ? ' ' + series.unit : ''}`;
  const summary = $derived(
    `${series.kind === 'bars' ? t('Bar chart') : t('Trend')}${series.caption ? ', ' + series.caption : ''}: ` +
      pts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')
  );

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
    {:else}
      <Sparkline values={pts.map((p) => p.value)} height={H} pad={P} lastTitle={last >= 0 ? `${pts[last].label}: ${fmt(pts[last].value)}` : undefined} />
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
  @media (prefers-reduced-motion: no-preference) {
    rect {
      animation: grow 520ms cubic-bezier(0.3, 1.3, 0.5, 1) both;
    }
  }
  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }
</style>
