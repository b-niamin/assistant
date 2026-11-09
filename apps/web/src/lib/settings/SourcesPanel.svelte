<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy } from 'svelte';
  import { busy, type SourceState, type SourcesResult } from '#lib/extensions/sources.ts';
  import { hueFor } from './guide.ts';

  /**
   * Connected accounts of one extension (spec 002): each source with its state, the sync with a
   * progress bar while it runs (polled every few seconds), a few facts and the actions it offers.
   */
  let {
    extId,
    result,
    form
  }: {
    extId: string;
    result: SourcesResult;
    form?: { ok?: string; error?: string; source?: string } | null;
  } = $props();

  let polled = $state<SourcesResult | null>(null);
  // A fresh page load (after an action) wins over an older poll.
  $effect(() => {
    void result;
    polled = null;
  });
  const current = $derived(polled ?? result);
  const list = $derived(current.ok ? current.sources : []);

  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    try {
      const res = await fetch(`/settings/extensions/${encodeURIComponent(extId)}/sources`, { cache: 'no-store' });
      if (res.ok) polled = (await res.json()) as SourcesResult;
      else if (res.status === 403) return; // the 10-minute unlock ran out: stop
    } catch {
      /* the app is restarting: try again */
    }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (busy(list)) timer = setTimeout(poll, 3000);
  }
  $effect(() => {
    void list;
    schedule();
  });
  onDestroy(() => clearTimeout(timer));

  const STATE: Record<SourceState, { label: string; tone: string }> = {
    connected: { label: 'Connected', tone: 'good' },
    not_connected: { label: 'Not connected', tone: '' },
    reconnect: { label: 'Sign in again', tone: 'serious' },
    planned: { label: 'Coming later', tone: '' }
  };

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function ago(isoTime: string): string {
    const s = (Date.parse(isoTime) - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 45) return s < 0 ? 'just now' : 'in a moment';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const pct = (p: number) => `${Math.round(p * 100)}%`;
</script>

<section aria-labelledby="sources-title">
  <h2 id="sources-title">Connected accounts</h2>
  {#if !current.ok}
    <p class="muted">
      {current.reason === 'hidden'
        ? 'This extension is off or hidden from your profile, so its accounts are not shown.'
        : 'Could not read the accounts right now.'}
    </p>
  {:else if !list.length}
    <p class="muted">No accounts yet.</p>
  {:else}
    <div class="sources">
      {#each list as s (s.id)}
        {@const st = STATE[s.state]}
        {@const running = s.sync?.state === 'running' || s.sync?.state === 'queued'}
        <article class="card source" class:planned={s.state === 'planned'} aria-labelledby="src-{s.id}">
          <div class="top">
            <span class="mark" style="--hue: {hueFor(s.id)}" aria-hidden="true">{s.name.slice(0, 1)}</span>
            <div class="who">
              <h3 id="src-{s.id}">{s.name}</h3>
              {#if s.account}<span class="small">{s.account}</span>{/if}
            </div>
            <span class="status small {st.tone}">{st.label}</span>
          </div>

          {#if s.state !== 'connected' && (s.help || s.command)}
            <div class="connect">
              {#if s.help}<p class="small">{s.help}</p>{/if}
              {#if s.command}
                <p class="cmd"><code>{s.command}</code> <a class="small" href="/settings/terminal">Open the terminal</a></p>
              {/if}
            </div>
          {/if}

          {#if s.sync}
            <div class="sync" aria-live="polite">
              <div class="syncline">
                <span class="status small" class:good={s.sync.state === 'idle' && !s.sync.error} class:warning={running} class:critical={s.sync.state === 'failed'}>
                  {s.sync.state === 'running' ? 'Syncing' : s.sync.state === 'queued' ? 'Waiting to start' : s.sync.state === 'failed' ? 'Last sync failed' : 'Up to date'}
                </span>
                {#if s.sync.label}<span class="small label">{s.sync.label}</span>{/if}
                {#if running && s.sync.progress != null}<span class="small num pct">{pct(s.sync.progress)}</span>{/if}
              </div>
              {#if running}
                <div
                  class="bar"
                  class:indeterminate={s.sync.progress == null}
                  role="progressbar"
                  aria-label="{s.name} sync"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={s.sync.progress != null ? Math.round(s.sync.progress * 100) : undefined}
                >
                  <span style:width={s.sync.progress != null ? pct(s.sync.progress) : undefined}></span>
                </div>
              {/if}
              {#if s.sync.error}<p class="small err">{s.sync.error}</p>{/if}
              {#if s.sync.lastAt || s.sync.nextAt}
                <p class="small">
                  {#if s.sync.lastAt}Last sync {ago(s.sync.lastAt)}{/if}{#if s.sync.lastAt && s.sync.nextAt}&ensp;·&ensp;{/if}{#if s.sync.nextAt}next {ago(s.sync.nextAt)}{/if}
                </p>
              {/if}
            </div>
          {/if}

          {#if s.facts}
            <dl class="facts">
              {#each s.facts as f (f.label)}
                <div><dt>{f.label}</dt><dd class="num">{f.value}</dd></div>
              {/each}
            </dl>
          {/if}

          {#if form?.source === s.id && form.error}<p class="note bad" role="alert">{form.error}</p>{/if}
          {#if form?.source === s.id && form.ok}<p class="note good" role="status">{form.ok}</p>{/if}

          {#if s.actions}
            <div class="actions">
              {#each s.actions as a (a.id)}
                <form method="POST" action="?/source" use:enhance class="act" class:dated={!!a.date}>
                  <input type="hidden" name="source" value={s.id} />
                  <input type="hidden" name="action" value={a.id} />
                  {#if a.date}
                    <label class="field">
                      <span>{a.date.label}</span>
                      <input type="date" name="date" value={a.date.default ?? ''} min={a.date.min} max={a.date.max} required disabled={a.disabled} />
                    </label>
                  {/if}
                  <button class="btn" disabled={a.disabled}>{a.label}</button>
                  {#if a.help}<p class="small help">{a.help}</p>{/if}
                </form>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  section {
    margin-bottom: var(--space-5);
  }
  h2 {
    margin-bottom: var(--space-3);
  }
  .sources {
    display: grid;
    gap: var(--space-3);
  }
  .source {
    display: grid;
    gap: var(--space-4);
  }
  .source.planned {
    padding-block: var(--space-4);
    background: transparent;
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 0.9375rem/1 var(--mono);
  }
  .planned .mark {
    filter: grayscale(1);
    opacity: 0.6;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  h3 {
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  p {
    margin: 0;
  }
  .connect {
    display: grid;
    gap: var(--space-2);
  }
  .cmd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .cmd code {
    overflow-wrap: anywhere;
  }
  .sync {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--grid);
  }
  .syncline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .pct {
    font-weight: 600;
    color: var(--ink);
  }
  .err {
    color: var(--critical);
  }
  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .bar.indeterminate span {
    width: 30%;
    animation: slide 1.4s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.indeterminate span {
      animation: none;
      width: 100%;
      opacity: 0.4;
    }
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  .facts div {
    display: grid;
    gap: 2px;
  }
  dt {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3) var(--space-5);
  }
  .act {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .act .help {
    flex-basis: 100%;
    max-width: 360px;
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .note {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .note.bad {
    border-left: 3px solid var(--critical);
  }
  .note.good {
    border-left: 3px solid var(--accent);
  }
</style>
