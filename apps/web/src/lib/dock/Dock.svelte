<script lang="ts">
  /**
   * The dock: a thin bar at the bottom of every page. Collapsed, it shows whether the Remote Control
   * sessions of the `claude` container (Claude Code, Codex) are up. Expanded, it holds the app's only
   * terminal (spec 004): a shell in the terminal container, kept in tmux, for signing in and for running
   * Claude or Codex by hand (sign-ins are in System settings). The terminal is created on first open and stays connected while collapsed.
   * The Remote menu sums the sessions up in one dot (all up: green, some: orange, none: grey) and can
   * start one that is down in the background of the terminal container.
   */
  import { onMount } from 'svelte';
  import { deserialize } from '$app/forms';
  import Mascot from '#lib/Mascot.svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';
  import { dock, runInDock } from './dock.svelte.ts';

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
    background: { claude: boolean; codex: boolean };
    outdated: boolean;
    update: { state: string; sha: string; actions: string } | null;
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
  let menuOpen = $state(false);
  let menu = $state<HTMLElement>();
  let starting = $state<'' | 'claude' | 'codex'>('');
  let startError = $state('');

  const REMOTES = [
    { id: 'claude', name: 'Claude Code', where: 'claude.ai/code or the Claude app', login: 'claude' },
    { id: 'codex', name: 'Codex', where: 'the ChatGPT or Codex app', login: 'codex login --device-auth' }
  ] as const;
  const LABEL: Record<Remote, string> = { starting: 'Starting', running: 'Running', restarting: 'Restarting', 'signed-out': 'Not signed in', off: 'Not running' };

  // Up = the claude container's session runs, or one started here in the background.
  const agents = $derived(
    REMOTES.map((r) => {
      const state: Remote = status?.reachable ? status.remote[r.id] : 'off';
      const background = !!status?.background?.[r.id];
      return { ...r, state, background, up: state === 'running' || background, signedIn: !!status?.[r.id] };
    })
  );
  const upCount = $derived(agents.filter((a) => a.up).length);
  const tone = $derived(upCount === agents.length ? 'good' : upCount ? 'serious' : '');
  const summary = $derived(upCount === agents.length ? 'all running' : upCount ? `${upCount} of ${agents.length} running` : 'none running');

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

  /** Start an agent's Remote Control in the background of the terminal container. */
  async function startRemote(agent: 'claude' | 'codex') {
    starting = agent;
    startError = '';
    try {
      const res = await fetch('/dock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start: agent })
      });
      if (!res.ok) startError = ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Could not start it.';
      await refresh();
    } finally {
      starting = '';
    }
  }

  /** Locked: the dock opens with its password prompt; the menu closes so it is in view. */
  function openTerminal() {
    menuOpen = false;
    dock.open = true;
    refresh();
  }

  function onWindowClick(e: MouseEvent) {
    if (menuOpen && menu && !menu.contains(e.target as Node)) menuOpen = false;
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
    queued.forEach((item, i) =>
      setTimeout(() => (item.run !== undefined ? win?.runInNewWindow(item.run) : win?.type(item.type)), 1200 + i * 900)
    );
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

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

<section class="dock" class:open={dock.open} aria-label="Terminal and remote sessions">
  <div class="strip">
    <button class="toggle" type="button" onclick={toggle} aria-expanded={dock.open} aria-controls="dock-panel">
      <span class="mark" aria-hidden="true">›_</span>
      <span class="label">Terminal</span>
      {#if started}<span class="status small" class:good={phase === 'open'} title={phase === 'open' ? 'Connected' : 'Not connected'}><span class="sr">{phase === 'open' ? 'Connected' : 'Not connected'}</span></span>{/if}
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
    </button>
    {#if status?.update?.state === 'updating'}
      <a class="chip" href="/settings#up-h" title="Rebuilding: {status.update.actions}">
        <span class="status small warning pulse">Updating to {status.update.sha}</span>
      </a>
    {:else if status?.update?.state === 'available'}
      <a class="chip" href="/settings#up-h" title="A new version is on GitHub: update it from System settings">
        <span class="status small available">Update available</span>
      </a>
    {:else if status?.update?.state === 'stale'}
      <a class="chip" href="/settings#up-h" title="The auto-update has not run for a while: new commits are not deployed">
        <span class="status small critical">Updates stopped</span>
      </a>
    {/if}
    <div class="remote" bind:this={menu}>
      <button
        class="remote-btn"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="dock-remote"
        title="Remote Control: {summary}"
        onclick={() => {
          menuOpen = !menuOpen;
          if (menuOpen) refresh();
        }}
      >
        <span class="status small {tone}">Remote</span>
        <span class="sr">: {summary}</span>
        <svg class="chev" class:up={menuOpen} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
      </button>
      {#if menuOpen}
        <div class="menu card" id="dock-remote" role="region" aria-label="Remote Control">
          <p class="menu-head">Remote Control <span>{summary}</span></p>
          <ul>
            {#each agents as a (a.id)}
              <li>
                <span class="status small" class:good={a.up} class:warning={!a.up && (a.state === 'starting' || a.state === 'restarting')}></span>
                <span class="what">
                  <strong>{a.name}</strong>
                  <span class="meta">
                    {#if a.state === 'running'}Running in the claude container · open it from {a.where}
                    {:else if a.background}Running in the background (terminal) · open it from {a.where}
                    {:else if !a.signedIn}Not signed in
                    {:else}{LABEL[a.state]}{/if}
                  </span>
                </span>
                {#if !a.up}
                  {#if !a.signedIn}
                    <button type="button" class="btn small-btn" onclick={() => (runInDock(a.login), (menuOpen = false))}>Sign in</button>
                  {:else if !status?.unlocked}
                    <button type="button" class="btn small-btn" onclick={openTerminal} title="Starting it needs the app password">Unlock to start</button>
                  {:else}
                    <button type="button" class="btn btn-primary small-btn" disabled={starting !== ''} onclick={() => startRemote(a.id)}>
                      {starting === a.id ? 'Starting…' : 'Start in background'}
                    </button>
                  {/if}
                {/if}
              </li>
            {/each}
          </ul>
          {#if status?.outdated}
            <p class="bad">An update is still building: the containers run the previous version, which cannot report or start these yet.</p>
          {:else if status && !status.reachable}
            <p class="bad">The terminal container is not answering.</p>
          {/if}
          {#if startError}<p class="bad" role="alert">{startError}</p>{/if}
          <p class="meta foot">The claude container starts these on its own once you are signed in. A background one runs in the terminal container until it restarts.</p>
        </div>
      {/if}
    </div>
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
  .remote {
    position: relative;
    margin-left: auto;
  }
  .chip {
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--ink-2);
    text-decoration: none;
    white-space: nowrap;
  }
  .chip + .remote {
    margin-left: 0;
  }
  .chip .available::before {
    background: var(--accent);
  }
  .chip:hover {
    color: var(--ink);
  }
  @media (prefers-reduced-motion: no-preference) {
    .pulse::before {
      animation: pulse 1s ease-in-out infinite;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .remote-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 30px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .remote-btn:hover {
    background: var(--surface-2);
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    width: min(420px, calc(100vw - 24px));
    padding: var(--space-3) var(--space-4);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 35%);
    z-index: 2;
  }
  .menu-head {
    display: flex;
    justify-content: space-between;
    margin: 0 0 var(--space-1);
    font-weight: 600;
    font-size: 0.875rem;
  }
  .menu-head span {
    font-weight: 400;
    color: var(--ink-2);
  }
  .menu ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .menu li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .menu .what {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
  }
  .menu .meta {
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .menu .foot {
    margin: var(--space-2) 0 0;
    color: var(--ink-3);
  }
  .menu .bad {
    margin: var(--space-1) 0 0;
    color: var(--critical);
    font-size: 0.8125rem;
  }
  .small-btn {
    flex: none;
    font-size: 0.8125rem;
    padding: 4px 10px;
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
  @media (max-width: 640px) {
    .strip {
      gap: var(--space-2);
      padding: 0 var(--space-3);
    }
    .panel {
      padding: 0 var(--space-2) var(--space-2);
    }
  }
</style>
