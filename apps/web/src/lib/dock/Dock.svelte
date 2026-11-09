<script lang="ts">
  /**
   * The dock: a thin bar at the bottom of every page. Collapsed, it shows whether the Remote Control
   * sessions of the `claude` container (Claude Code, Codex) are up. Expanded, it holds the app's only
   * terminal (spec 004): a shell in the terminal container, kept in tmux, for signing in and for running
   * Claude or Codex by hand. The terminal is created on first open and stays connected while collapsed.
   */
  import { onMount } from 'svelte';
  import { deserialize } from '$app/forms';
  import Mascot from '#lib/Mascot.svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';
  import { dock } from './dock.svelte.ts';

  type Phase = 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  type Remote = 'starting' | 'running' | 'restarting' | 'signed-out' | 'off';
  interface Status {
    configured: boolean;
    reachable: boolean;
    unlocked: boolean;
    claude: boolean;
    codex: boolean;
    gh: boolean;
    remote: { claude: Remote; codex: Remote };
  }

  let status = $state<Status | null>(null);
  let win = $state<TerminalWindow>();
  let phase = $state<Phase>('idle');
  // The terminal exists from the first open on, so a collapse never drops the session.
  let started = $state(false);
  let password = $state('');
  let unlockError = $state('');
  let unlocking = $state(false);
  // Open or closed is remembered per browser; written only after it was read back on load.
  let restored = $state(false);

  const REMOTES = [
    { id: 'claude', name: 'Claude', where: 'claude.ai/code or the Claude app' },
    { id: 'codex', name: 'Codex', where: 'the ChatGPT or Codex app' }
  ] as const;
  const TONE: Record<Remote, string> = { starting: 'warning', running: 'good', restarting: 'warning', 'signed-out': '', off: '' };
  const LABEL: Record<Remote, string> = { starting: 'starting', running: 'remote on', restarting: 'restarting', 'signed-out': 'not signed in', off: 'off' };

  const SHORTCUTS = $derived(
    status
      ? [
          status.claude ? { label: 'Claude', cmd: 'claude' } : { label: 'Sign in to Claude', cmd: 'claude', hint: 'then type /login' },
          status.codex ? { label: 'Codex', cmd: 'codex' } : { label: 'Sign in to Codex', cmd: 'codex login --device-auth' },
          ...(status.gh ? [] : [{ label: 'Sign in to GitHub', cmd: 'gh auth login' }])
        ]
      : []
  );

  async function refresh() {
    try {
      const res = await fetch('/dock', { cache: 'no-store' });
      if (res.ok) status = await res.json();
    } catch {
      /* the app is restarting: keep the last known state */
    }
  }

  function toggle() {
    dock.open = !dock.open;
    if (dock.open) refresh();
  }

  function shortcut(cmd: string) {
    win?.runInNewWindow(cmd);
    // A sign-in takes a while: look again a few times so the indicators catch up without a reload.
    for (const ms of [5000, 15000, 30000, 60000]) setTimeout(refresh, ms);
  }

  /** The same unlock as System settings (10 minutes), without leaving the page. */
  async function unlock(e: SubmitEvent) {
    e.preventDefault();
    unlocking = true;
    unlockError = '';
    try {
      const body = new FormData();
      body.set('password', password);
      const res = await fetch('/settings?/unlock', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
      const result = deserialize(await res.text());
      if (result.type === 'success') {
        password = '';
        if (status) status.unlocked = true;
      } else unlockError = (result.type === 'failure' && (result.data?.error as string)) || 'Could not unlock.';
    } catch {
      unlockError = 'Could not unlock.';
    } finally {
      unlocking = false;
    }
  }

  $effect(() => {
    if (dock.open && status?.configured && status.unlocked) started = true;
  });

  // A failed connection after the unlock ran out: ask for the password again.
  $effect(() => {
    if (phase === 'error' && started) {
      refresh().then(() => {
        if (status && !status.unlocked && phase !== 'open') started = false;
      });
    }
  });

  // Commands from pages (runInDock) wait for the connection, then each gets its own tmux window.
  $effect(() => {
    if (phase !== 'open' || !win || !dock.queue.length) return;
    const queued = dock.queue;
    dock.queue = [];
    // tmux needs a moment after the socket opens before it takes keys.
    queued.forEach((cmd, i) => setTimeout(() => win?.runInNewWindow(cmd), 1200 + i * 900));
  });

  $effect(() => {
    if (!restored) return;
    try {
      localStorage.setItem('dock.open', dock.open ? '1' : '');
    } catch {
      /* no storage */
    }
  });

  onMount(() => {
    try {
      if (localStorage.getItem('dock.open')) dock.open = true;
    } catch {
      /* no storage */
    }
    restored = true;
    refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 30_000);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

<section class="dock" class:open={dock.open} aria-label="Terminal and remote sessions">
  <div class="strip">
    <button class="toggle" type="button" onclick={toggle} aria-expanded={dock.open} aria-controls="dock-panel">
      <span class="mark" aria-hidden="true">›_</span>
      <span class="label">Terminal</span>
      {#if started}<span class="status small" class:good={phase === 'open'} title={phase === 'open' ? 'Connected' : 'Not connected'}><span class="sr">{phase === 'open' ? 'Connected' : 'Not connected'}</span></span>{/if}
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
    </button>
    <ul class="remotes" aria-label="Remote Control">
      {#each REMOTES as r (r.id)}
        {@const state = status?.reachable ? status.remote[r.id] : 'off'}
        <li class="status small {TONE[state]}" title="{r.name} Remote Control: {LABEL[state]}{state === 'running' ? `. Open it from ${r.where}.` : ''}">
          <span class="name">{r.name}</span><span class="state">{LABEL[state]}</span>
        </li>
      {/each}
    </ul>
  </div>

  <div class="panel" id="dock-panel" hidden={!dock.open}>
    {#if !status}
      <p class="note">Checking the terminal…</p>
    {:else if !status.configured}
      <p class="note">The terminal is off. Set <code>SIDECAR_TICKET_SECRET</code> in <code>.env</code> and run <code>docker compose up -d</code>.</p>
    {:else if !started}
      <form class="unlock" onsubmit={unlock}>
        <Mascot mood="asleep" size={44} decorative />
        <label>
          <span>The terminal opens a shell, so it asks for the app password again (10 minutes).</span>
          <input type="password" bind:value={password} autocomplete="current-password" placeholder="App password" required />
        </label>
        <button class="btn btn-primary" disabled={unlocking}>Unlock</button>
        {#if unlockError}<p class="bad" role="alert">{unlockError}</p>{/if}
      </form>
    {/if}
    {#if started}
      <div class="shortcuts" role="toolbar" aria-label="Run in a new window">
        {#each SHORTCUTS as s (s.label)}
          <button type="button" class="run" disabled={phase !== 'open'} onclick={() => shortcut(s.cmd)} title={s.hint ? `${s.cmd}, ${s.hint}` : s.cmd}>
            <code>{s.cmd}</code><span>{s.label}</span>
          </button>
        {/each}
        <span class="meta">Each runs in a new tmux window. The remote sessions run on their own, in the claude container.</span>
      </div>
      <TerminalWindow bind:this={win} bind:phase configured={status?.configured ?? true} reachable={status?.reachable ?? true} height="min(50vh, 480px)" />
    {/if}
  </div>
</section>

<style>
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    background: var(--surface);
    border-top: 1px solid var(--ring);
    box-shadow: 0 -6px 20px -14px rgb(0 0 0 / 30%);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .strip {
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 40px;
    padding: 0 var(--space-4);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 10px 0 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--surface-2);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--hue-violet) 16%, transparent);
    color: var(--hue-violet);
    font: 700 0.6875rem/1 var(--mono);
  }
  .chev {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 160ms ease;
  }
  .open .chev {
    transform: rotate(180deg);
  }
  .remotes {
    display: flex;
    gap: var(--space-4);
    margin: 0 0 0 auto;
    padding: 0;
    list-style: none;
    font-size: 0.8125rem;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .remotes .name {
    color: var(--ink);
    font-weight: 550;
  }
  .remotes .state::before {
    content: ' · ';
    color: var(--ink-3);
  }
  .panel {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 var(--space-4) var(--space-3);
  }
  .panel[hidden] {
    display: none;
  }
  .note {
    margin: 0;
    padding: var(--space-3) 0;
    color: var(--ink-2);
    font-size: 0.875rem;
  }
  .unlock {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .unlock label {
    display: grid;
    gap: var(--space-1);
    flex: 1 1 280px;
    font-size: 0.875rem;
    color: var(--ink-2);
  }
  .unlock input {
    max-width: 320px;
  }
  .unlock .bad {
    flex-basis: 100%;
    margin: 0;
    color: var(--critical);
    font-size: 0.875rem;
  }
  .shortcuts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0 var(--space-2);
  }
  .shortcuts .meta {
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .run {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    border: 1px solid #2c2c2a;
    background: #141413;
    color: #e8e6df;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .run code {
    background: none;
    padding: 0;
    color: inherit;
  }
  .run code::before {
    content: '$ ';
    color: var(--hue-orange);
  }
  .run span {
    color: #a3a29a;
  }
  .run:hover:not(:disabled) {
    border-color: var(--hue-orange);
  }
  .run:disabled {
    opacity: 0.55;
    cursor: default;
  }
  @media (max-width: 640px) {
    .strip {
      gap: var(--space-2);
      padding: 0 var(--space-3);
    }
    .remotes {
      gap: var(--space-3);
    }
    .remotes .state,
    .shortcuts .meta,
    .run span {
      display: none;
    }
    .panel {
      padding: 0 var(--space-2) var(--space-2);
    }
  }
</style>
