<script lang="ts">
  /**
   * The dock: a thin bar at the bottom of every page. Collapsed, it shows the terminal toggle and the
   * update state. Expanded, it holds the app's only terminal (spec 004): a shell in the terminal
   * container, kept in tmux, for signing in and for running Claude or Codex by hand (sign-ins are in
   * System settings). The terminal is created on first open and stays connected while collapsed.
   * The Remote Control sessions live in the header's Remote menu (RemoteMenu.svelte).
   */
  import { onMount } from 'svelte';
  import { deserialize } from '$app/forms';
  import Mascot from '#lib/Mascot.svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';
  import { dock, refreshDock as refresh } from './dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  type Phase = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

  const status = $derived(dock.status);
  let win = $state<TerminalWindow>();
  let phase = $state<Phase>('idle');
  // The terminal exists from the first open on, so a collapse never drops the session.
  let started = $state(false);
  let password = $state('');
  let unlockError = $state('');
  let unlocking = $state(false);
  // Open or closed is remembered per browser; written only after it was read back on load.
  let restored = $state(false);

  function toggle() {
    dock.open = !dock.open;
    if (dock.open) refresh();
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
        if (dock.status) dock.status.unlocked = true;
      } else unlockError = (result.type === 'failure' && (result.data?.error as string)) || t('Could not unlock.');
    } catch {
      unlockError = t('Could not unlock.');
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

<!-- While the terminal is open the page behind it is blurred and dimmed; a click there collapses it. -->
<div class="backdrop" class:shown={dock.open} aria-hidden="true" onclick={() => (dock.open = false)}></div>

<section class="dock" class:open={dock.open} aria-label={t('Terminal')}>
  <!-- The whole bar toggles the terminal for a mouse; the keyboard has the buttons inside it. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="strip" onclick={(e) => !(e.target as Element).closest('a, button') && toggle()}>
    <span class="handle" aria-hidden="true" title={dock.open ? t('Collapse') : t('Expand')}></span>
    <button class="toggle" type="button" onclick={toggle} aria-expanded={dock.open} aria-controls="dock-panel" title={dock.open ? t('Collapse the terminal') : t('Open the terminal')}>
      <span class="mark" aria-hidden="true">›_</span>
      <span class="label">{t('Terminal')}</span>
      {#if started}<span class="status small" class:good={phase === 'open'} title={phase === 'open' ? t('Connected') : t('Not connected')}><span class="sr">{phase === 'open' ? t('Connected') : t('Not connected')}</span></span>{/if}
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
      {#if dock.open}<span class="hint">{t('Collapse')}</span>{/if}
    </button>
    {#if status?.update?.state === 'updating'}
      <a class="chip" href="/settings#up-h" title={t('Rebuilding: {actions}', { actions: status.update.actions })}>
        <span class="status small warning pulse">{t('Updating to {sha}', { sha: status.update.sha })}{status.update.steps ? ` · ${status.update.step}/${status.update.steps}` : ''}</span>
      </a>
    {:else if status?.update?.state === 'available'}
      <a class="chip" href="/settings#up-h" title={t('A new version is on GitHub: update it from System settings')}>
        <span class="status small available">{t('Update available')}</span>
      </a>
    {:else if status?.update?.pendingRestart}
      <a class="chip" href="/settings#up-h" title={t('{services} run the previous version: restart them from System settings', { services: status.update.pendingRestart })}>
        <span class="status small warning">{t('Restart needed')}</span>
      </a>
    {:else if status?.update?.state === 'interrupted'}
      <a class="chip" href="/settings#up-h" title={t("The update's process stopped; the updater resumes it, or resume it from System settings")}>
        <span class="status small warning">{t('Update interrupted')}</span>
      </a>
    {:else if status?.update?.state === 'stale'}
      <a class="chip" href="/settings#up-h" title={t('The updater has not run for a while: new commits are not deployed')}>
        <span class="status small critical">{t('Updates stopped')}</span>
      </a>
    {/if}
  </div>

  <div class="panel" id="dock-panel" hidden={!dock.open}>
    {#if !status}
      <p class="note">{t('Checking the terminal…')}</p>
    {:else if !status.configured}
      <p class="note">{t('The terminal is off. Set SIDECAR_TICKET_SECRET in .env and run docker compose up -d.')}</p>
    {:else if !started}
      <form class="unlock" onsubmit={unlock}>
        <Mascot mood="asleep" size={44} decorative />
        <label>
          <span>{t('The terminal opens a shell, so it asks for the app password again (10 minutes).')}</span>
          <input type="password" bind:value={password} autocomplete="current-password" placeholder={t('App password')} required />
        </label>
        <button class="btn btn-primary" disabled={unlocking}>{t('Unlock')}</button>
        {#if unlockError}<p class="bad" role="alert">{unlockError}</p>{/if}
      </form>
    {/if}
    {#if started}
      <TerminalWindow bind:this={win} bind:phase configured={status?.configured ?? true} reachable={status?.reachable ?? true} height="min(50vh, 480px)" />
    {/if}
  </div>
</section>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 29;
    background: color-mix(in srgb, var(--page) 35%, rgb(0 0 0 / 18%));
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    opacity: 0;
    visibility: hidden;
  }
  .backdrop.shown {
    opacity: 1;
    visibility: visible;
  }
  @media (prefers-reduced-motion: no-preference) {
    .backdrop {
      transition:
        opacity 180ms ease,
        visibility 0s linear 180ms;
    }
    .backdrop.shown {
      transition: opacity 180ms ease;
    }
  }
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
    position: relative;
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 40px;
    padding: 0 var(--space-4);
    cursor: pointer;
  }
  /* Open, the bar reads as the drawer's lid: its own surface, a line under it, a grab handle on top. */
  .open .strip {
    max-width: none;
    padding-inline: max(var(--space-4), calc((100% - 1120px) / 2 + var(--space-4)));
    background: var(--surface-2);
    border-bottom: 1px solid var(--ring);
  }
  .open .strip:hover {
    background: color-mix(in srgb, var(--surface-2) 70%, var(--axis));
  }
  .handle {
    position: absolute;
    top: 0;
    left: 50%;
    translate: -50% 0;
    width: 56px;
    height: 14px;
  }
  .handle::before {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    top: 5px;
    height: 4px;
    border-radius: 2px;
    background: var(--axis);
  }
  .strip:hover .handle::before {
    background: var(--ink-3);
  }
  .hint {
    color: var(--ink-2);
    font-weight: 500;
    font-size: 0.8125rem;
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
  .open .toggle:hover {
    background: var(--surface);
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
  .chip {
    margin-left: auto;
    font-size: 0.8125rem;
    color: var(--ink-2);
    text-decoration: none;
    white-space: nowrap;
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
  .panel {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 var(--space-4) var(--space-3);
  }
  .open .panel {
    padding-top: var(--space-3);
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
    .open .strip {
      padding-inline: var(--space-3);
    }
    .panel {
      padding: 0 var(--space-2) var(--space-2);
    }
  }
</style>
