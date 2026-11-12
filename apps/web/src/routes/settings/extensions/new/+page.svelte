<script lang="ts">
  import { onMount } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import { askAgent, runInDock } from '#lib/dock/dock.svelte.ts';
  import { hueFor, installCommand } from '#lib/settings/guide.ts';
  import { guessAccessory } from '#lib/mascot.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();

  let polled = $state<{ id: string; name: string; href: string }[] | null>(null);
  const installed = $derived(polled ?? data.installed);
  const installedIds = $derived(installed.map((e) => e.id));
  const ready = $derived(data.catalog.extensions.filter((e) => !installedIds.includes(e.id)));
  // Only the agents signed in to the terminal; if none is, name both so it is clear what to sign in to.
  const AGENTS = [
    { id: 'claude', name: 'Claude' },
    { id: 'codex', name: 'Codex' }
  ] as const;
  const signedIn = $derived(AGENTS.filter((a) => data.agents[a.id]));
  const agents = $derived(signedIn.length ? signedIn : AGENTS);
  // Apps that appeared while this page was open (built or installed in the dock's terminal).
  let fresh = $state<{ id: string; name: string; href: string }[]>([]);

  onMount(() => {
    const known = new Set(data.installed.map((e) => e.id));
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/settings/extensions/installed.json', { cache: 'no-store' });
        if (!res.ok) return;
        const list = (await res.json()) as { id: string; name: string; href: string }[];
        polled = list;
        fresh = list.filter((e) => !known.has(e.id));
      } catch {
        /* the app is restarting with a new build */
      }
    }, 10_000);
    return () => clearInterval(timer);
  });

  function scrollRow(id: string, dir: number) {
    const el = document.getElementById(id);
    el?.scrollBy({ left: dir * Math.max(260, el.clientWidth * 0.8), behavior: 'smooth' });
  }
</script>

<svelte:head><title>{t('Extend the system')} · {t('System settings')}</title></svelte:head>

<div class="hero">
  <div class="head">
    <p class="eyebrow"><a href="/settings">{t('System settings')}</a></p>
    <h1>{t('Extend the system')}</h1>
  </div>
  <div class="pip">
    <p class="bubble">{t('Install an app, or build your own!')}</p>
    <Mascot mood="charged" size={96} decorative />
  </div>
</div>

{#if installed.length}
  <nav class="installed" aria-label={t('Installed apps')}>
    <span class="meta">{t('Installed')}</span>
    {#each installed as e (e.id)}
      <a class="chip" href="/settings/extensions/{e.id}">
        <span class="dot" style="--hue: {hueFor(e.id)}" aria-hidden="true"></span>{e.name}
      </a>
    {/each}
  </nav>
{/if}

{#if data.catalog.error}
  <div class="card none"><Mascot mood="tired" size={44} decorative /><p class="meta">{t('Could not read the extensions repo.')} <span class="small">({data.catalog.error})</span></p></div>
{/if}

{#if ready.length}
  <section class="block" aria-labelledby="ready-h">
    <div class="sh">
      <h2 id="ready-h">{t('Ready to install')}</h2>
      <div class="arrows">
        <button type="button" class="btn-ghost arrow" aria-label={t('Previous')} onclick={() => scrollRow('row-ready', -1)}>‹</button>
        <button type="button" class="btn-ghost arrow" aria-label={t('Next')} onclick={() => scrollRow('row-ready', 1)}>›</button>
      </div>
    </div>
    <ul class="row" id="row-ready">
      {#each ready as e (e.id)}
        <li class="card tile" style="--hue: {hueFor(e.id)}">
          <span class="mark" aria-hidden="true"><Mascot mood="steady" size={34} accessory={e.accessory ?? guessAccessory(e.id, e.name)} decorative /></span>
          <h3>{e.name}</h3>
          <p class="meta grow">{e.description}</p>
          <button type="button" class="btn btn-primary"
            onclick={() =>
              askAgent(
                `Install the ready-made extension ${e.id}: run ${installCommand(e.id)}; if it lacks one of the app's languages, ` +
                  `translate it (add-extension skill); then tell me what to set up.`
              )}>
            {t('Install')}
          </button>
          {#if e.service}<p class="meta small">{t('Then')} <code>sudo ./install.sh</code> {t('on the host, once.')}</p>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#each fresh as f (f.id)}
  <div class="card done" role="status">
    <Mascot mood="charged" size={44} decorative />
    <strong class="grow">{t('{name} is ready', { name: f.name })}</strong>
    <a class="btn btn-primary" href={f.href}>{t('Open')}</a>
    <a class="btn" href="/settings/extensions/{f.id}">{t('Settings')}</a>
  </div>
{/each}

<section class="block own card" aria-labelledby="own-h">
  <Mascot mood="steady" size={40} decorative />
  <div class="grow">
    <h2 id="own-h">{t('Build your own')}</h2>
    <p class="meta">
      {t('Ask')}
      {#each agents as a, n (a.id)}{#if n > 0} {t('or')} {/if}<button type="button" class="agent" title={t('Open {name} in the terminal', { name: a.name })} onclick={() => runInDock(a.id)}>{a.name}</button>{/each}
      {t('in the terminal to build your own extension.')}
      {#if !signedIn.length}{t('Sign in there first.')}{/if}
    </p>
  </div>
</section>

<style>
  .hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }
  .head {
    display: grid;
    gap: var(--space-1);
  }
  .head h1,
  .head p {
    margin: 0;
  }
  .pip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .bubble {
    max-width: 180px;
    margin: 0;
    padding: 10px 14px;
    border-radius: 16px 16px 4px 16px;
    background: var(--surface);
    border: 1px solid var(--ring);
    font-size: 0.875rem;
    color: var(--ink);
  }
  @media (max-width: 560px) {
    .bubble {
      display: none;
    }
  }
  .installed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-5);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--ring);
    background: var(--surface);
    color: var(--ink);
    font-size: 0.875rem;
    text-decoration: none;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--hue);
  }
  .own {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .own h2 {
    margin: 0 0 var(--space-1);
    font-size: 1.125rem;
  }
  .agent {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--ring);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .agent:hover {
    border-color: var(--accent);
  }
  .block {
    margin-bottom: var(--space-5);
  }
  .sh {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
  }
  .sh h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  .arrows {
    display: flex;
    gap: var(--space-1);
  }
  .arrow {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 1.25rem;
    line-height: 1;
  }
  @media (hover: none) {
    .arrows {
      display: none;
    }
  }
  .row {
    list-style: none;
    margin: 0;
    padding: 2px 2px var(--space-2);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(220px, 250px);
    gap: var(--space-3);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: thin;
  }
  .tile {
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 3px solid var(--hue);
  }
  .tile h3 {
    margin: 0;
    font-size: 1rem;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--hue) 18%, var(--surface));
    color: var(--ink);
    font-weight: 700;
  }
  .meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .small {
    font-size: 0.75rem;
  }
  .grow {
    flex: 1;
  }
  .done {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
</style>
