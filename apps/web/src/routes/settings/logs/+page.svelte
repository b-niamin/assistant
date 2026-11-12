<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { hueFor } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();
  let query = $state('');
  let follow = $state(false);
  let box = $state<HTMLElement>();

  const shown = $derived(query.trim() ? data.lines.filter((l) => l.text.toLowerCase().includes(query.trim().toLowerCase())) : data.lines);
  const time = (at: number) =>
    at ? new Date(at).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : '';
  const label = (file: string) => file.replace(/\.log$/, '');

  // Newest at the bottom, like a terminal.
  $effect(() => {
    void shown;
    if (box) box.scrollTop = box.scrollHeight;
  });

  $effect(() => {
    if (!follow) return;
    const t = setInterval(() => invalidateAll(), 5000);
    return () => clearInterval(t);
  });
</script>

<svelte:head><title>{t('Logs')} · {t('System settings')}</title></svelte:head>

<div class="head">
  <div class="name">
    <span class="mark" style="--hue: var(--hue-blue)" aria-hidden="true">≡</span>
    <h1>{t('Logs')}</h1>
  </div>
  <p class="muted">{t('What the app, the updater and the services write to /logs.')}</p>
</div>

<div class="bar">
  <nav class="tabs" aria-label={t('Log file')}>
    <a href="?" aria-current={data.file === '' ? 'page' : undefined}>{t('All')}</a>
    {#each data.files as f (f.name)}
      <a href="?file={encodeURIComponent(f.name)}" aria-current={data.file === f.name ? 'page' : undefined}>
        <span class="dot" style="--hue: {hueFor(f.name)}" aria-hidden="true"></span>{label(f.name)}
      </a>
    {/each}
  </nav>
  <div class="tools">
    <input type="search" placeholder={t('Filter')} bind:value={query} aria-label={t('Filter lines')} />
    <label class="check"><input type="checkbox" bind:checked={follow} /> {t('Follow')}</label>
    <button type="button" class="btn" onclick={() => invalidateAll()}>{t('Refresh')}</button>
  </div>
</div>

{#if !data.files.length}
  <div class="card none"><Mascot mood="idle" size={44} decorative /><p class="muted">{t('No logs yet.')}</p></div>
{:else}
  <div class="log" bind:this={box} role="log" aria-label={t('Log lines')}>
    {#each shown as l, i (i)}
      <div class="line">
        <span class="t">{time(l.at)}</span>
        {#if !data.file}<span class="src" style="--hue: {hueFor(l.file)}">{label(l.file)}</span>{/if}
        <span class="x">{l.text}</span>
      </div>
    {:else}
      <p class="empty">{t('Nothing matches.')}</p>
    {/each}
  </div>
  <p class="meta">
    {t.n(shown.length, '{n} line', '{n} lines')}{data.file ? ` ${t('from the end of {file}', { file: data.file })}` : `, ${t('newest of every log, merged by time')}`}.
    {t('Logs of the terminal container:')} <code>docker compose logs terminal</code> {t('on the host.')}
  </p>
{/if}

<style>
  .head {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 1rem/1 var(--mono);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .tabs a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    color: var(--ink-2);
    text-decoration: none;
    font-size: 0.875rem;
    background: var(--surface-2);
  }
  .tabs a[aria-current='page'] {
    background: var(--ink);
    color: var(--surface);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--hue);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tools input[type='search'] {
    width: 180px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.875rem;
    color: var(--ink-2);
  }
  .log {
    height: min(68vh, 720px);
    overflow: auto;
    padding: var(--space-3);
    border-radius: 12px;
    border: 1px solid #2c2c2a;
    background: #141413;
    color: #e8e6df;
    font: 0.8125rem/1.55 var(--mono);
  }
  .line {
    display: flex;
    gap: var(--space-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .t {
    flex: none;
    width: 15ch;
    white-space: nowrap;
    color: #6e6d68;
  }
  .src {
    flex: none;
    width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in srgb, var(--hue) 70%, #fff);
  }
  .x {
    min-width: 0;
  }
  .empty {
    margin: 0;
    color: #a3a29a;
  }
  .meta {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  @media (max-width: 640px) {
    .t {
      display: none;
    }
    .src {
      width: 8ch;
    }
    .tools input[type='search'] {
      width: 120px;
    }
  }
</style>
