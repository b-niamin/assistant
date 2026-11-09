<script lang="ts">
  import { onMount } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';
  import { parsePending, pendingCommand, PENDING_PROMPT_KEY, type PendingTask } from '#lib/settings/guide.ts';

  let { data } = $props();

  let win: TerminalWindow;
  let phase = $state<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  // The page load's status until the first poll after a login.
  let polled = $state<typeof data.status | null>(null);
  const status = $derived(polled ?? data.status);
  // A task left by "Extend the system": shown above the terminal until it is run or dismissed.
  let pending = $state<PendingTask | null>(null);
  const pendingNeeds = $derived(pending?.tool === 'claude' ? status.claude : pending?.tool === 'codex' ? status.codex : true);

  const LOGINS = [
    {
      id: 'claude',
      name: 'Claude Code',
      mark: 'C',
      hue: 'var(--brand)',
      cmd: 'claude',
      use: 'claude',
      about: 'Builds and changes apps; Claude Remote uses this login too.',
      hint: 'Run it, then type /login and open the link it prints.'
    },
    {
      id: 'codex',
      name: 'Codex',
      mark: 'X',
      hue: 'var(--hue-aqua)',
      cmd: 'codex login --device-auth',
      use: 'codex',
      about: 'Builds and changes apps with your ChatGPT plan.',
      hint: 'Sign in with ChatGPT: enter the code at the URL it prints.'
    },
    {
      id: 'gh',
      name: 'GitHub CLI',
      mark: 'G',
      hue: 'var(--hue-violet)',
      cmd: 'gh auth login',
      use: 'gh auth status',
      about: 'Lets the tools push to and read your GitHub repositories.',
      hint: 'Choose GitHub.com, HTTPS, then log in with a web browser.'
    }
  ] as const;
  const signedIn = $derived(LOGINS.filter((l) => status[l.id]).map((l) => l.name));

  /** Quick action: type the command and run it. Ctrl+U first clears a half-typed line. */
  function run(cmd: string) {
    win?.run(cmd);
    // A login takes a while; look again a few times so the card turns green without a reload.
    for (const ms of [5000, 15000, 30000, 60000]) setTimeout(refreshStatus, ms);
  }

  function clearPending() {
    pending = null;
    try {
      sessionStorage.removeItem(PENDING_PROMPT_KEY);
    } catch {
      /* no storage */
    }
  }

  // The app a task built or installed, once it shows up (the web app rebuilds itself first).
  let fresh = $state<{ id: string; name: string; href: string } | null>(null);
  function watchForNew(before: string[]) {
    const known = new Set(before);
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await fetch('/settings/extensions/installed.json', { cache: 'no-store' });
        if (res.ok) {
          const list = (await res.json()) as { id: string; name: string; href: string }[];
          const found = list.find((e) => !known.has(e.id));
          if (found) return (fresh = found);
        }
      } catch {
        /* the app is restarting with the new build: try again */
      }
      if (Date.now() - started < 45 * 60_000) setTimeout(tick, 10_000);
    };
    setTimeout(tick, 10_000);
  }

  function runPending() {
    if (!pending) return;
    run(pendingCommand(pending));
    if (pending.before) watchForNew(pending.before);
    clearPending();
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/settings/terminal/status');
      if (res.ok) polled = await res.json();
    } catch {
      /* keep the last known status */
    }
  }

  onMount(() => {
    try {
      pending = parsePending(sessionStorage.getItem(PENDING_PROMPT_KEY));
    } catch {
      /* no storage */
    }
    const onVisible = () => document.visibilityState === 'visible' && refreshStatus();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

<svelte:head><title>Terminal · Assistant</title></svelte:head>


<div class="head rise" style="--i: 0">
  <p class="eyebrow"><a href="/settings">System settings</a></p>
  <div class="name">
    <span class="mark big" style="--hue: var(--hue-violet)" aria-hidden="true">›_</span>
    <h1>Terminal</h1>
    {#if !data.configured}<span class="status small warning">Off</span>
    {:else if !status.reachable}<span class="status small critical">Not answering</span>
    {:else}<span class="status small good">On</span>{/if}
  </div>
  <p class="muted">A shell for signing in to command-line tools and building apps with Claude or Codex.</p>
  <p class="meta">
    Own container · shared Claude home · tmux keeps it running ·
    {signedIn.length ? `signed in: ${signedIn.join(', ')}` : 'nothing signed in yet'}
  </p>
</div>

{#if !data.configured}
  <p class="card warn rise" style="--i: 1">
    <span class="status warning">The terminal is off.</span> Set <code>SIDECAR_TICKET_SECRET</code> in
    <code>.env</code> (<code>openssl rand -hex 32</code>) and run <code>docker compose up -d</code>.
  </p>
{/if}

<section class="rise" style="--i: 1" aria-labelledby="tools-h">
  <h2 id="tools-h">Tools</h2>
  <ul class="menu card">
    {#each LOGINS as l (l.id)}
      {@const ok = status[l.id]}
      <li class="tool">
        <span class="mark" style="--hue: {l.hue}" aria-hidden="true">{l.mark}</span>
        <span class="what">
          <strong>{l.name}</strong>
          <span class="meta">{ok ? l.about : l.hint}</span>
        </span>
        <span class="status small" class:good={ok}>{ok ? 'Signed in' : 'Not signed in'}</span>
        <button
          class="run"
          class:quiet={ok}
          type="button"
          disabled={phase !== 'open'}
          onclick={() => run(ok ? l.use : l.cmd)}
          title={ok ? `Run ${l.use}` : l.hint}
          aria-label="Run {ok ? l.use : l.cmd}"
        >
          <code>{ok ? l.use : l.cmd}</code>
          <span class="short">{ok ? 'Open' : 'Sign in'}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5 10.5 8 5 12.5" /></svg>
        </button>
      </li>
    {/each}
  </ul>
</section>

{#if fresh}
  <section class="ready card rise" style="--i: 4" aria-live="polite">
    <Mascot mood="charged" size={48} decorative />
    <div class="ask">
      <h2>{fresh.name} is ready</h2>
      <p class="small">Keep talking to Claude here to change it, or open its settings: the same conversation can go on from there.</p>
    </div>
    <div class="go">
      <a class="btn btn-primary" href={fresh.href}>Open {fresh.name}</a>
      <a class="btn" href="/settings/extensions/{fresh.id}">Settings</a>
    </div>
  </section>
{/if}

{#if pending}
  <section class="ready card rise" id="ready" style="--i: 4" aria-label="Ready to build">
    <Mascot mood="charged" size={48} decorative />
    <div class="ask">
      <h2>{pending.title}</h2>
      <p class="said">{pending.tool === 'shell' ? pendingCommand(pending) : pending.text}</p>
      <p class="small">
        {#if pending.tool === 'shell'}
          This copies the app from the extensions repo and turns it on; the app rebuilds by itself within a minute.
        {:else}
          This starts {pending.tool === 'codex' ? 'Codex' : 'Claude Code'} with your request. It builds the app in the
          repo; answer it in the terminal if it asks something. When it is done, the app appears in System settings.
        {/if}
      </p>
    </div>
    <div class="go">
      <button class="btn btn-primary" type="button" disabled={phase !== 'open' || !pendingNeeds} onclick={runPending}>
        {pending.tool === 'shell' ? 'Run it' : pending.tool === 'codex' ? 'Run in Codex' : 'Run in Claude'}
      </button>
      <button class="btn-ghost" type="button" onclick={clearPending}>Dismiss</button>
      {#if !pendingNeeds}<p class="small">Sign in to {pending.tool === 'codex' ? 'Codex' : 'Claude Code'} first (Tools above).</p>{/if}
    </div>
  </section>
{/if}

<div class="rise" style="--i: 5">
  <TerminalWindow bind:this={win} bind:phase configured={data.configured} reachable={status.reachable} />
</div>

<style>
  .head {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
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
  .meta {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  section {
    margin-bottom: var(--space-5);
  }
  .ready {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3) var(--space-4);
    align-items: start;
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border-color: var(--accent);
  }
  .ready h2,
  .ready p {
    margin: 0;
  }
  .ask {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .said {
    font: 0.8125rem/1.5 var(--mono);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    overflow-wrap: anywhere;
  }
  .ready .go {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .warn {
    border-color: var(--warning);
    margin: 0 0 var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  /* Tools: one row each, like the System list in settings */
  .menu {
    list-style: none;
    margin: 0;
    padding: var(--space-1) var(--space-4);
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .tool {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 0.8125rem/1 var(--mono);
  }
  .mark.big {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    font-size: 0.9375rem;
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .tool > .status {
    flex: none;
    white-space: nowrap;
  }
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .run {
    flex: 0 1 230px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    height: 38px;
    padding: 0 10px 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid #2c2c2a;
    background: #141413;
    color: #e8e6df;
    text-align: left;
    transition:
      transform 120ms ease,
      border-color 120ms ease;
  }
  .run code {
    background: none;
    padding: 0;
    color: inherit;
    font-size: 0.8125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .run code::before {
    content: '$ ';
    color: var(--hue);
  }
  .short {
    display: none;
    font-weight: 600;
    font-size: 0.875rem;
  }
  .run svg {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.7;
  }
  .run:hover:not(:disabled) {
    border-color: var(--hue);
  }
  .run:active:not(:disabled) {
    transform: translateY(1px);
  }
  .run.quiet {
    background: var(--surface-2);
    border-color: var(--ring);
    color: var(--ink-2);
  }
  .run:disabled {
    cursor: default;
    opacity: 0.55;
  }
  /* The terminal window: dark in both themes */
  @media (max-width: 640px) {
    .head {
      margin-bottom: var(--space-4);
    }
    .menu {
      padding: var(--space-1) var(--space-3);
    }
    .what .meta {
      display: none;
    }
    .run {
      flex: none;
      gap: 4px;
    }
    .run code {
      display: none;
    }
    .run .short {
      display: inline;
    }
  }
</style>
