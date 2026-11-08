<script lang="ts">
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import AskAI from '$lib/settings/AskAI.svelte';
  import {
    hueFor,
    initials,
    inspirationPrompt,
    installCommand,
    newAppPrompt,
    PENDING_PROMPT_KEY,
    type PendingTask
  } from '$lib/settings/guide';

  let { data } = $props();

  const installedIds = $derived(data.installed.map((e) => e.id));
  const ready = $derived(data.catalog.extensions.filter((e) => !installedIds.includes(e.id)));
  const termOk = $derived(data.terminal.configured && data.terminal.reachable);

  function toTerminal(task: PendingTask) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ ...task, before: installedIds }));
    } catch {
      /* private mode */
    }
    goto('/settings/terminal#ready');
  }

  function scrollRow(id: string, dir: number) {
    const el = document.getElementById(id);
    el?.scrollBy({ left: dir * Math.max(260, el.clientWidth * 0.8), behavior: 'smooth' });
  }
</script>

<svelte:head><title>Extend the system · System settings</title></svelte:head>

<div class="hero">
  <div class="head">
    <p class="eyebrow"><a href="/settings">System settings</a></p>
    <h1>Extend the system</h1>
  </div>
  <div class="pip">
    <p class="bubble">Install an app, or tell me what to build!</p>
    <Mascot mood="charged" size={96} decorative />
  </div>
</div>

{#if data.installed.length}
  <nav class="installed" aria-label="Installed apps">
    <span class="meta">Installed</span>
    {#each data.installed as e (e.id)}
      <a class="chip" href="/settings/extensions/{e.id}">
        <span class="dot" style="--hue: {hueFor(e.id)}" aria-hidden="true"></span>{e.name}
      </a>
    {/each}
  </nav>
{/if}

{#if data.catalog.error}
  <div class="card none"><Mascot mood="tired" size={44} decorative /><p class="meta">{data.catalog.error}</p></div>
{/if}

{#if ready.length}
  <section class="block" aria-labelledby="ready-h">
    <div class="sh">
      <h2 id="ready-h">Ready to install</h2>
      <div class="arrows">
        <button type="button" class="btn-ghost arrow" aria-label="Previous" onclick={() => scrollRow('row-ready', -1)}>‹</button>
        <button type="button" class="btn-ghost arrow" aria-label="Next" onclick={() => scrollRow('row-ready', 1)}>›</button>
      </div>
    </div>
    <ul class="row" id="row-ready">
      {#each ready as e (e.id)}
        <li class="card tile" style="--hue: {hueFor(e.id)}">
          <span class="mark" aria-hidden="true">{initials(e.name)}</span>
          <h3>{e.name}</h3>
          <p class="meta grow">{e.description}</p>
          <button type="button" class="btn btn-primary" disabled={!termOk}
            onclick={() => toTerminal({ tool: 'shell', text: installCommand(e.id), title: `Install ${e.name}` })}>
            Install
          </button>
          {#if e.service}<p class="meta small">Then <code>sudo ./install.sh</code> on the host, once.</p>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.catalog.inspirations.length}
  <section class="block" aria-labelledby="insp-h">
    <div class="sh">
      <h2 id="insp-h">Build with AI</h2>
      <div class="arrows">
        <button type="button" class="btn-ghost arrow" aria-label="Previous" onclick={() => scrollRow('row-insp', -1)}>‹</button>
        <button type="button" class="btn-ghost arrow" aria-label="Next" onclick={() => scrollRow('row-insp', 1)}>›</button>
      </div>
    </div>
    <ul class="row" id="row-insp">
      {#each data.catalog.inspirations as i (i.id)}
        {@const p = inspirationPrompt(i)}
        <li class="card tile" style="--hue: {hueFor(i.id)}">
          <span class="mark" aria-hidden="true">{initials(i.name)}</span>
          <h3>{i.name}</h3>
          <p class="meta grow">{i.description}</p>
          <div class="acts">
            <button type="button" class="btn btn-primary" disabled={!termOk || !data.terminal.claude}
              onclick={() => toTerminal({ tool: 'claude', text: p, title: `Build ${i.name} with Claude` })}>Claude</button>
            <button type="button" class="btn" disabled={!termOk || !data.terminal.codex}
              onclick={() => toTerminal({ tool: 'codex', text: p, title: `Build ${i.name} with Codex` })}>Codex</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="block" aria-label="Your own app">
  <AskAI
    title="Or describe your own"
    placeholder="e.g. a habit tracker for water and stretching, with a streak on the dashboard"
    prompt={newAppPrompt}
    taskTitle="Build your app"
    terminal={data.terminal}
    installed={installedIds}
  />
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
  .acts {
    display: flex;
    gap: var(--space-2);
  }
  .acts .btn-primary {
    flex: 1;
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
</style>
