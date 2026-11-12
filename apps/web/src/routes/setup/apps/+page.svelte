<script lang="ts">
  import { onMount } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import SetupUnlock from '#lib/setup/SetupUnlock.svelte';
  import { dock, runInDock } from '#lib/dock/dock.svelte.ts';
  import { guessAccessory } from '#lib/mascot.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();

  let polled = $state<{ fetched: string[]; built: string[] } | null>(null);
  const installed = $derived(new Set(polled?.built ?? data.installed.map((e) => e.id)));
  const fetched = $derived(new Set(polled?.fetched ?? []));
  let picked = $state<string[]>([]);
  let asked = $state<string[]>([]);
  const waiting = $derived(asked.filter((id) => !installed.has(id)));
  let handoff = $state(0);
  let since = $state(0);
  /**
   * Where the install is: the terminal opens and runs `ext install` (sending, installing), then the app
   * rebuilds itself with the new apps (building, about a minute; the page may not answer for a moment).
   */
  const stage = $derived(
    !waiting.length ? '' : waiting.every((id) => fetched.has(id)) ? 'building' : dock.handoff?.n === handoff && dock.handoff?.state === 'waiting' ? 'sending' : 'installing'
  );
  let now = $state(Date.now());
  const nameOf = (id: string) => data.catalog.extensions.find((e) => e.id === id)?.name ?? id;

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }
  function install() {
    const ids = picked.filter((id) => !installed.has(id));
    if (!ids.length) return;
    handoff = runInDock(`node scripts/ext.mjs install ${ids.join(' ')}`);
    asked = [...asked, ...ids];
    since = Date.now();
    picked = [];
  }

  // All in: the terminal's drawer closes again, so it does not cover the next step's buttons.
  let wasWaiting = false;
  $effect(() => {
    if (waiting.length) wasWaiting = true;
    else if (wasWaiting) {
      wasWaiting = false;
      dock.open = false;
    }
  });

  // Installs land within seconds of the command; the list follows them.
  onMount(() => {
    const timer = setInterval(async () => {
      now = Date.now();
      if (!waiting.length) return;
      try {
        const res = await fetch('/setup/apps/progress.json', { cache: 'no-store' });
        if (res.ok) polled = await res.json();
      } catch {
        /* the app is restarting with the new apps */
      }
    }, 2000);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(since ? Math.max(0, Math.round((now - since) / 1000)) : 0);
</script>

<svelte:head><title>{t('Apps')} · {t('Set up')}</title></svelte:head>

<div class="intro">
  <Mascot mood="steady" size={64} accessory="party-hat" decorative />
  <h1>{t('What should it do?')}</h1>
  <p>{t('Pick ready-made apps. More can be added any time, or built by the AI from your own idea.')}</p>
</div>

{#if data.catalog.error}
  <p class="card none"><Mascot mood="tired" size={40} decorative /><span class="meta">{t('Could not read the extensions repo.')} ({data.catalog.error})</span></p>
{:else}
  <ul class="apps">
    {#each data.catalog.extensions as e (e.id)}
      {@const on = installed.has(e.id)}
      {@const sel = picked.includes(e.id)}
      <li>
        <button type="button" class="card app" class:sel class:on aria-pressed={on || sel} disabled={on || waiting.includes(e.id)} onclick={() => toggle(e.id)}>
          <Mascot mood="steady" size={40} accessory={e.accessory ?? guessAccessory(e.id, e.name)} decorative />
          <span class="txt">
            <strong>{e.name}{#if on} <span class="pill">{t('Installed')}</span>{/if}</strong>
            <span class="meta">{e.description}</span>
            {#if e.needs}<span class="meta needs">{t('Needs')}: {e.needs}</span>{/if}
          </span>
          <span class="tick" class:busy={waiting.includes(e.id)} aria-hidden="true">
            {#if on}✓{:else if waiting.includes(e.id)}<span class="spin"></span>{:else if sel}✓{/if}
          </span>
          <span class="sr">{on ? t('Installed') : waiting.includes(e.id) ? t('Installing') : sel ? t('Picked') : t('Not picked')}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if waiting.length}
  {@const apps = waiting.map(nameOf).join(', ')}
  <div class="card progress" role="status">
    <span class="spin" aria-hidden="true"></span>
    <span class="txt">
      <strong>
        {stage === 'sending'
          ? t('Opening the terminal…')
          : stage === 'installing'
            ? t('Downloading {apps}…', { apps })
            : t('Adding {apps} to the app…', { apps })}
      </strong>
      <span class="meta">
        {stage === 'building'
          ? t('The app rebuilds itself with the new apps, usually within a minute or two; this page may not answer for a moment.')
          : t('In the terminal at the bottom, where you can follow it.')}
        {#if elapsed >= 5}<span class="elapsed">{t('{n} s', { n: elapsed })}</span>{/if}
      </span>
    </span>
  </div>
{/if}

{#if !data.terminal}
  <p class="meta">{t('Apps are installed in the terminal, which is not available right now. Add them later in System settings, Apps.')}</p>
{:else if !data.unlocked}
  <SetupUnlock />
{/if}

<div class="nav">
  <a class="skip" href="/setup/system">{asked.length ? '' : t('Skip for now')}</a>
  <div class="go">
    {#if picked.length && data.terminal && data.unlocked}
      <button type="button" class="btn btn-primary" onclick={install}>{t.n(picked.length, 'Install one app', 'Install {n} apps')}</button>
    {:else}
      <a class="btn" class:btn-primary={!picked.length} href="/setup/system">{t('Continue')}</a>
    {/if}
  </div>
</div>

<style>
  .apps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .app {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .app:hover:not(:disabled) {
      border-color: var(--axis);
    }
  }
  .app.sel {
    border-color: var(--accent);
    background: var(--accent-wash);
  }
  .app.on {
    cursor: default;
  }
  .txt {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .pill {
    margin-left: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--good) 15%, transparent);
    color: var(--good-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .needs {
    font-size: var(--text-xs);
  }
  .tick {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--axis);
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
  }
  .tick.busy {
    box-shadow: none;
    color: var(--accent-ink);
    font-size: 18px;
  }
  .sel .tick {
    background: var(--accent-fill);
    box-shadow: none;
    color: #fff;
  }
  .on .tick {
    background: var(--good);
    box-shadow: none;
    color: #fff;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--accent-wash);
    border-color: var(--accent);
  }
  .progress > .spin {
    font-size: 20px;
    color: var(--accent-ink);
  }
  .progress .txt {
    text-align: left;
  }
  .elapsed {
    margin-left: var(--space-2);
    font-variant-numeric: tabular-nums;
    color: var(--ink-3);
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  p.meta {
    margin: 0;
    text-align: center;
  }
  .go {
    display: flex;
    gap: var(--space-2);
  }
</style>
