<script lang="ts">
  /**
   * A short trend (`$shell/ui`, specs/001): the history in the de-emphasis grey, the latest reading in
   * the series hue (`--series`, else the accent). A trend glyph, not a record: missing values are bridged
   * so the shape stays readable. Decorative: say the values in text next to it, or pass `lastTitle`.
   */
  let { values, height = 28, pad = 5, lastTitle }: { values: (number | null)[]; height?: number; pad?: number; lastTitle?: string } = $props();

  let W = $state(120);
  const vals = $derived(values.filter((v): v is number => v !== null));
  const min = $derived(Math.min(...vals));
  const span = $derived(Math.max(...vals) - min || 1);
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const path = $derived.by(() => {
    let d = '';
    values.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  });
  const last = $derived(values.findLastIndex((v) => v !== null));
</script>

<div class="spark" style:height="{height}px" bind:clientWidth={W}>
  {#if vals.length >= 2}
    <svg width={W} {height} aria-hidden="true">
      <path d={path} pathLength="1" />
      <circle cx={x(last)} cy={y(values[last]!)} r="3.5">{#if lastTitle}<title>{lastTitle}</title>{/if}</circle>
    </svg>
  {/if}
</div>

<style>
  svg {
    display: block;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: var(--axis);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  circle {
    fill: var(--series, var(--accent));
    stroke: var(--surface);
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
  }
  @media (prefers-reduced-motion: no-preference) {
    path {
      stroke-dasharray: 1;
      animation: draw 900ms cubic-bezier(0.65, 0, 0.35, 1) 150ms both;
    }
    circle {
      animation: pop 360ms cubic-bezier(0.3, 1.6, 0.5, 1) 950ms both;
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
