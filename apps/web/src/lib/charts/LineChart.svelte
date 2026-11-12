<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';
  import { niceTicks, runsOf } from './ticks';

  /**
   * One or more series over time (`$shell/ui`, specs/001): 2px lines (a 10 % wash under a single one),
   * hairline grid, round y ticks, the latest value labelled at the end, crosshair + tooltip on hover and
   * arrow keys, and a table twin. Gaps stay gaps. Drawn in pixel space (width measured) so text and
   * marks never stretch. Labels come in already translated.
   */
  type Series = { label: string; hue?: string; values: (number | null)[] };
  let {
    labels,
    series,
    format,
    tick = format,
    xLabel = (x: string) => x,
    label,
    column,
    ticks: makeTicks = (lo: number, hi: number) => niceTicks(lo, hi, 4),
    floor = null,
    ceil = null,
    height = 240,
    pad = { left: 52, right: 64 },
    step = 7
  }: {
    /** One per point along x, e.g. ISO days or times; `xLabel` turns one into text. */
    labels: string[];
    series: Series[];
    /** A value in the tooltip, the end label and the table. */
    format: (v: number | null) => string;
    /** A y tick (default: format). */
    tick?: (v: number) => string;
    /** An x label, short under the axis or long (`long`) in the tooltip and the table. */
    xLabel?: (x: string, long: boolean) => string;
    /** What the chart shows, for screen readers and the table. */
    label: string;
    /** The table's first column (default "Time"). */
    column?: string;
    /** Ticks covering lo..hi (default niceTicks; byteTicks or scaledTicks from $shell). */
    ticks?: (lo: number, hi: number) => number[];
    /** The y axis starts here (0 for percentages and rates) unless data goes lower; null = the data's low. */
    floor?: number | null;
    /** And never ends below this (100 for percentages). */
    ceil?: number | null;
    height?: number;
    pad?: { left: number; right: number };
    /** Points moved by Shift + arrow. */
    step?: number;
  } = $props();
  const t = useT();

  const H = $derived(height);
  const TOP = 16;
  const BOTTOM = 28;
  let W = $state(720);
  let hover = $state<number | null>(null);

  const all = $derived(series.flatMap((l) => l.values).filter((v): v is number => v !== null));
  const ticks = $derived.by(() => {
    if (!all.length) return [];
    const lo = Math.min(...all, floor ?? Infinity);
    const hi = Math.max(...all, ceil ?? -Infinity, lo + 1e-9);
    return makeTicks(lo, hi);
  });
  const lo = $derived(ticks[0] ?? 0);
  const hi = $derived(ticks[ticks.length - 1] ?? 1);
  const n = $derived(labels.length);
  const innerW = $derived(Math.max(10, W - pad.left - pad.right));
  const x = (i: number) => pad.left + (i / Math.max(1, n - 1)) * innerW;
  const y = (v: number) => TOP + (1 - (v - lo) / (hi - lo || 1)) * (H - TOP - BOTTOM);
  const base = $derived(H - BOTTOM);
  const single = $derived(series.length === 1);
  const hueOf = (l: Series) => (l.hue ? `var(--hue-${l.hue})` : undefined);

  const path = (r: { i: number; v: number }[]) => r.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = (r: { i: number; v: number }[]) => `${path(r)}L${x(r[r.length - 1].i).toFixed(1)},${base}L${x(r[0].i).toFixed(1)},${base}Z`;
  const lastOf = (values: (number | null)[]) => values.findLastIndex((v) => v !== null);

  const xTicks = $derived.by(() => {
    const k = Math.max(2, Math.min(6, Math.floor(innerW / 110)));
    if (n < 2) return [];
    return Array.from({ length: k }, (_, j) => Math.round((j / (k - 1)) * (n - 1)));
  });

  function onMove(e: PointerEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    hover = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - pad.left) / innerW) * (n - 1))));
  }
  function onKey(e: KeyboardEvent) {
    if (!n) return;
    const from = hover ?? Math.max(...series.map((l) => lastOf(l.values)));
    if (e.key === 'ArrowLeft') hover = Math.max(0, from - (e.shiftKey ? step : 1));
    else if (e.key === 'ArrowRight') hover = Math.min(n - 1, from + (e.shiftKey ? step : 1));
    else if (e.key === 'Escape') hover = null;
    else return;
    e.preventDefault();
  }
  const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(x(hover), 80), W - 80));
</script>

<figure class="chart" bind:clientWidth={W}>
  {#if !all.length}
    <div class="empty" style:height="{H}px">
      <Mascot mood="idle" size={44} decorative />
      <span>{t('No readings in this range yet.')}</span>
    </div>
  {:else}
    {#if !single}
      <ul class="legend">
        {#each series as l}<li style:--series={hueOf(l)}><span class="key"></span>{l.label}</li>{/each}
      </ul>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <svg
      width={W}
      height={H}
      role="img"
      aria-label={t('{label}, {from} to {to}. Use arrow keys to read values.', { label, from: xLabel(labels[0], true), to: xLabel(labels[n - 1], true) })}
      tabindex="0"
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
      onkeydown={onKey}
      onblur={() => (hover = null)}
    >
      {#each ticks as v}
        <line class="grid" x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} />
        <text x={pad.left - 8} y={y(v)} dy="0.32em" text-anchor="end">{tick(v)}</text>
      {/each}
      <line class="baseline" x1={pad.left} x2={W - pad.right} y1={base} y2={base} />
      {#each xTicks as i}
        <text x={x(i)} y={H - 8} text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{xLabel(labels[i], false)}</text>
      {/each}

      {#each series as l}
        <g style:--series={hueOf(l)}>
          {#each runsOf(l.values) as r}
            {#if single}<path class="area" d={area(r)} />{/if}
            {#if r.length === 1}
              <circle class="lone" cx={x(r[0].i)} cy={y(r[0].v)} r="2.5" />
            {:else}
              <path class="line" d={path(r)} pathLength="1" />
            {/if}
          {/each}
          {#if lastOf(l.values) >= 0}
            {@const i = lastOf(l.values)}
            <g class="end" class:away={hover !== null}>
              <circle class="dot" cx={x(i)} cy={y(l.values[i]!)} r="4.5" />
              <text class="endlabel" x={x(i) + 10} y={y(l.values[i]!)} dy="0.32em">{format(l.values[i])}</text>
            </g>
          {/if}
          {#if hover !== null && l.values[hover] !== null}
            <circle class="dot" cx={x(hover)} cy={y(l.values[hover]!)} r="4.5" />
          {/if}
        </g>
      {/each}
      {#if hover !== null}
        <line class="cross" x1={x(hover)} x2={x(hover)} y1={TOP} y2={base} />
      {/if}
    </svg>

    {#if hover !== null}
      <div class="tip" style:left="{tipLeft}px" aria-live="polite">
        {#each series as l}
          <strong style:--series={hueOf(l)}>{#if !single}<span class="key"></span>{/if}{format(l.values[hover])}</strong>
        {/each}
        <span>{xLabel(labels[hover], true)}</span>
      </div>
    {/if}
  {/if}

  <details>
    <summary>{t('Show as table')}</summary>
    <div class="tablewrap">
      <table>
        <thead>
          <tr><th>{column ?? t('Time')}</th>{#each series as l}<th>{single ? label : l.label}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each labels.map((_, i) => n - 1 - i) as i}
            <tr><td>{xLabel(labels[i], true)}</td>{#each series as l}<td>{format(l.values[i])}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</figure>

<style>
  .chart {
    position: relative;
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    touch-action: pan-y;
    border-radius: var(--radius-sm);
  }
  .empty {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-2);
    color: var(--ink-3);
    border: 1px dashed var(--grid);
    border-radius: var(--radius-sm);
  }
  .legend {
    display: flex;
    gap: var(--space-4);
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key {
    display: inline-block;
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: var(--series);
    margin-right: 6px;
    vertical-align: middle;
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .baseline {
    stroke: var(--axis);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  text {
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
  .endlabel {
    fill: var(--ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
  }
  .end {
    transition: opacity 120ms;
  }
  .end.away {
    opacity: 0;
  }
  .area {
    fill: color-mix(in srgb, var(--series, var(--accent)) 12%, transparent);
  }
  .line {
    fill: none;
    stroke: var(--series, var(--accent));
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .lone {
    fill: var(--series, var(--accent));
  }
  .dot {
    fill: var(--series, var(--accent));
    stroke: var(--surface);
    stroke-width: 2;
  }
  .cross {
    stroke: var(--ink-3);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    display: grid;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow:
      0 0 0 1px var(--ring),
      0 4px 12px rgba(0, 0, 0, 0.08);
    pointer-events: none;
    white-space: nowrap;
    text-align: center;
  }
  .tip strong {
    font-size: var(--text-base);
  }
  .tip span {
    font-size: var(--text-xs);
    color: var(--ink-2);
  }
  @media (prefers-reduced-motion: no-preference) {
    .line {
      stroke-dasharray: 1;
      animation: draw 1100ms cubic-bezier(0.65, 0, 0.35, 1) both;
    }
    .area {
      animation: fade 700ms ease-out 400ms both;
    }
    .end {
      animation: fade 300ms ease-out 1000ms backwards;
    }
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  details {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }
  summary {
    cursor: pointer;
    color: var(--ink-2);
    width: fit-content;
  }
  .tablewrap {
    max-height: 280px;
    overflow: auto;
    margin-top: var(--space-2);
  }
  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 4px 16px 4px 0;
    border-bottom: 1px solid var(--grid);
  }
  th {
    color: var(--ink-2);
    font-weight: var(--weight-medium);
  }
</style>
