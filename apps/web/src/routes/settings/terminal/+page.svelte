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
      hint: 'Then type /login and open the link it prints.'
    },
    {
      id: 'codex',
      name: 'Codex',
      mark: 'X',
      hue: 'var(--hue-aqua)',
      cmd: 'codex login --device-auth',
      hint: 'Sign in with ChatGPT: enter the code at the URL it prints.'
    },
    {
      id: 'gh',
      name: 'GitHub CLI',
      mark: 'G',
      hue: 'var(--hue-violet)',
      cmd: 'gh auth login',
      hint: 'Choose GitHub.com, HTTPS, then log in with a web browser.'
    }
  ] as const;

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
  <h1>Terminal</h1>
  <p class="lede">
    A shell in its own container for signing in to command-line tools. Logins land in the shared Claude home, so
    Claude Remote picks them up, and the session (tmux) keeps running after you close this page.
  </p>
</div>

{#if !data.configured}
  <p class="card warn rise" style="--i: 1">
    <span class="status warning">The terminal is off.</span> Set <code>SIDECAR_TICKET_SECRET</code> in
    <code>.env</code> (<code>openssl rand -hex 32</code>) and run <code>docker compose up -d</code>.
  </p>
{/if}

<section class="logins" aria-label="Sign-ins">
  {#each LOGINS as l, i}
    {@const ok = status[l.id]}
    <article class="login card rise" style="--i: {i + 1}; --hue: {l.hue}">
      <span class="mark" aria-hidden="true">{l.mark}</span>
      <div class="who">
        <h2>{l.name}</h2>
        <span class="status small" class:good={ok}>{ok ? 'Signed in' : 'Not signed in'}</span>
      </div>
      <button
        class="run"
        class:quiet={ok}
        type="button"
        disabled={phase !== 'open'}
        onclick={() => run(l.cmd)}
        title={l.hint}
        aria-label="Run {l.cmd}"
      >
        <code>{l.cmd}</code>
        <span class="short">{ok ? 'Run' : 'Sign in'}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5 10.5 8 5 12.5" /></svg>
      </button>
      <p class="hint">{l.hint}</p>
    </article>
  {/each}
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
      {#if !pendingNeeds}<p class="small">Sign in to {pending.tool === 'codex' ? 'Codex' : 'Claude Code'} first (card above).</p>{/if}
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
  .lede {
    color: var(--ink-2);
    max-width: 68ch;
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

  /* Sign-in cards */
  .logins {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .login {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'mark who' 'run run' 'hint hint';
    align-items: center;
    /* Cards in a row share a height: keep the rows at the top so the buttons line up across cards. */
    align-content: start;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .mark {
    grid-area: mark;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 1rem/1 var(--mono);
  }
  .who {
    grid-area: who;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .run {
    grid-area: run;
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
  .hint {
    grid-area: hint;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  /* The terminal window: dark in both themes */
  @media (max-width: 640px) {
    .head {
      margin-bottom: var(--space-4);
    }
    .lede {
      font-size: 0.875rem;
    }
    .logins {
      gap: var(--space-2);
    }
    .login {
      grid-template-columns: auto 1fr auto;
      grid-template-areas: 'mark who run';
      padding: var(--space-3);
    }
    .hint {
      display: none;
    }
    .who .status {
      white-space: nowrap;
    }
    .run {
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
