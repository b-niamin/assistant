<script lang="ts">
  import { countUp } from '$lib/count-up';
  import { formatDelta, formatKpi, type TileData, type TileSize } from '$lib/extensions/tiles';
  import TileChart from './TileChart.svelte';
  import Mascot from '$lib/Mascot.svelte';

  type Result = { ok: true; data: TileData } | { ok: false; reason: 'timeout' | 'error' };
  let {
    title,
    source,
    shared,
    size,
    href,
    data,
    index = 0
  }: {
    title: string;
    source: string;
    shared: boolean;
    size: TileSize;
    href: string;
    data: Promise<Result>;
    index?: number;
  } = $props();

  /** The whole card is one link (stretched title link); an action button sits above it. */
  const linkOf = (r: Result | null) => (r?.ok && r.data.href ? r.data.href : href);
  let resolved = $state<Result | null>(null);
  $effect(() => {
    resolved = null;
    data.then((r) => (resolved = r));
  });
</script>

<article class="card tile {size}" style:--i={index}>
  <header>
    <h2><a href={linkOf(resolved)}>{title}</a></h2>
    <span class="src" title={shared ? 'Shared by all profiles' : 'Your profile'}>
      {#if source !== title}{source}{/if}{#if shared}<span class="shared" aria-label="shared">⇄</span>{/if}
    </span>
  </header>

  {#await data}
    <div class="skel" aria-hidden="true">
      <span class="b1"></span>
      {#if size !== 'sm'}<span class="b2"></span>{/if}
    </div>
    <span class="sr">Loading</span>
  {:then r}
    {#if !r.ok}
      <div class="pipnote">
        <Mascot mood="tired" size={36} decorative />
        <p class="soft">{r.reason === 'timeout' ? 'Still loading. Open to see more.' : 'Unavailable right now.'}</p>
      </div>
    {:else}
      {@const d = r.data}
      {#if d.kpis}
        <div class="kpis">
          {#each d.kpis as k, n}
            {@const delta = formatDelta(k)}
            <div class="kpi" class:main={n === 0}>
              <span class="label">{k.label}</span>
              <span class="value">
                {#if n === 0 && k.value !== null && Number.isInteger(k.value) && k.format !== 'duration' && Math.abs(k.value) < 100000}
                  <span class="fig" use:countUp={k.value}>{formatKpi(k)}</span>
                {:else}
                  <span class="fig">{formatKpi(k)}</span>
                {/if}
                {#if k.unit && k.value !== null}<span class="unit">{k.unit}</span>{/if}
              </span>
              {#if delta || k.status}
                <span class="aux">
                  {#if delta}
                    <span class="delta {delta.tone}" title="Change against the extension's baseline"
                      ><span aria-hidden="true">{delta.arrow}</span> {delta.text}</span
                    >
                  {/if}
                  {#if k.status}<span class="status {k.status.tone}">{k.status.label}</span>{/if}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if d.series && size !== 'sm'}
        <TileChart series={d.series} height={size === 'lg' ? 64 : 44} />
      {/if}
      {#if d.list}
        {#if d.list.length}
          <ul class="list">
            {#each d.list as item}
              <li><span>{item.label}</span>{#if item.meta}<span class="meta">{item.meta}</span>{/if}</li>
            {/each}
          </ul>
        {:else if !d.kpis}
          <div class="pipnote">
            <Mascot mood="steady" size={36} decorative />
            <p class="soft">Nothing coming up.</p>
          </div>
        {/if}
      {/if}
      {#if d.empty}
        <div class="empty">
          <div class="pipnote">
            <Mascot mood="idle" size={36} decorative />
            <p>{d.empty.message}</p>
          </div>
          {#if d.empty.action}<a class="btn action" href={d.empty.action.href}>{d.empty.action.label}</a>{/if}
        </div>
      {/if}
      {#if d.note}<p class="note">{d.note}</p>{/if}
    {/if}
  {/await}
</article>

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 132px;
    transition:
      border-color 120ms,
      transform 160ms;
  }
  .tile.lg {
    grid-column: span 2;
  }
  .tile:hover {
    border-color: var(--accent);
  }
  .tile:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--ink-2);
    letter-spacing: 0;
  }
  h2 a {
    color: inherit;
    text-decoration: none;
    outline: none;
  }
  /* Stretched link: the whole card is clickable without nesting interactive elements. */
  h2 a::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .src {
    font-size: 0.75rem;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .shared {
    margin-left: 4px;
  }
  .kpis {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2) var(--space-5);
  }
  .kpi {
    display: grid;
    gap: 2px;
  }
  .kpi .label {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .value {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .fig {
    font-size: 1.375rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .main .fig {
    font-size: 2rem;
  }
  .unit {
    font-size: 0.875rem;
    color: var(--ink-2);
  }
  .aux {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: 0.75rem;
  }
  .delta {
    color: var(--ink-2);
    font-weight: 600;
  }
  .delta.good {
    color: var(--good-ink);
  }
  .delta.bad {
    color: var(--critical);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.875rem;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .list li span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .empty {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    margin-top: auto;
  }
  .pipnote {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .empty p,
  .soft {
    margin: 0;
    color: var(--ink-2);
    font-size: 0.875rem;
  }
  .action {
    display: inline-flex;
    align-items: center;
    position: relative;
    z-index: 1;
    font-size: 0.8125rem;
    text-decoration: none;
  }
  .note {
    margin: auto 0 0;
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .skel {
    display: grid;
    gap: var(--space-2);
  }
  .skel span {
    display: block;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .b1 {
    width: 40%;
    height: 32px;
  }
  .b2 {
    height: 44px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .tile {
      animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      animation-delay: calc(var(--i) * 45ms);
    }
    .tile:hover {
      transform: translateY(-1px);
    }
    .skel span {
      animation: pulse 1.2s ease-in-out infinite alternate;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes pulse {
    to {
      opacity: 0.45;
    }
  }
  @media (max-width: 560px) {
    .tile.lg {
      grid-column: auto;
    }
  }
</style>
