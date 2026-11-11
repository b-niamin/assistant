<script lang="ts">
  /**
   * The dock: a thin bar at the bottom of every page while the session is unlocked (the lock in the
   * header, LockMenu.svelte). Expanded, it holds the app's only terminal (spec 004): a shell in the
   * terminal container, kept in tmux, where Claude Code and Codex run (sign-ins are in System settings).
   * The terminal is created on first open and stays connected while collapsed, until the lock closes it.
   */
  import { onMount } from 'svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';
  import { dock, dockShown, refreshDock as refresh } from './dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  type Phase = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

  const status = $derived(dock.status);
  let win = $state<TerminalWindow>();
  let phase = $state<Phase>('idle');
  // Open or closed is remembered per browser; written only after it was read back on load.
  let restored = $state(false);
  const shown = $derived(dockShown());

  let toggleButton = $state<HTMLButtonElement>();

  function toggle() {
    dock.open = !dock.open;
    if (dock.open) refresh();
  }

  /**
   * The terminal takes Tab and Escape for the shell, so the keyboard needs its own way out: F6 anywhere,
   * or Escape outside the terminal itself, collapses the dock and puts focus back on its button.
   */
  function onKey(e: KeyboardEvent) {
    if (!dock.open) return;
    const inTerminal = (e.target as Element | null)?.closest?.('.xterm');
    if (e.key === 'F6' || (e.key === 'Escape' && !inTerminal)) {
      e.preventDefault();
      dock.open = false;
      toggleButton?.focus();
    }
  }

  // The terminal exists from the first open on, so a collapse never drops the session.
  $effect(() => {
    if (dock.open && shown) dock.started = true;
  });

  // A connection that fails after the unlock ran out: the dock goes, the lock asks for the password again.
  $effect(() => {
    if (phase === 'error' && dock.started) {
      refresh().then(() => {
        if (status && !status.unlocked && phase !== 'open') {
          dock.started = false;
          dock.open = false;
          dock.unlockAsked = true;
        }
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

<svelte:window onkeydown={onKey} />

{#if shown}
<!-- While the terminal is open the page behind it is blurred and dimmed; a click there collapses it. -->
<div class="backdrop" class:shown={dock.open} aria-hidden="true" onclick={() => (dock.open = false)}></div>

<section class="dock" class:open={dock.open} aria-label={t('Terminal')}>
  <!-- The whole bar toggles the terminal for a mouse; the keyboard has the buttons inside it. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="strip" onclick={(e) => !(e.target as Element).closest('a, button') && toggle()}>
    <span class="handle" aria-hidden="true" title={dock.open ? t('Collapse') : t('Expand')}></span>
    <button class="toggle" type="button" bind:this={toggleButton} onclick={toggle} aria-expanded={dock.open} aria-controls="dock-panel" title={dock.open ? t('Collapse the terminal') : t('Open the terminal')}>
      <span class="mark" aria-hidden="true">›_</span>
      <span class="label">{t('Terminal')}</span>
      {#if dock.started}<span class="status small" class:good={phase === 'open'} title={phase === 'open' ? t('Connected') : t('Not connected')}><span class="sr">{phase === 'open' ? t('Connected') : t('Not connected')}</span></span>{/if}
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
      {#if dock.open}<span class="hint">{t('Collapse')} <kbd>F6</kbd></span>{/if}
    </button>
  </div>

  <div class="panel" id="dock-panel" hidden={!dock.open}>
    {#if dock.started}
      <TerminalWindow bind:this={win} bind:phase configured={status?.configured ?? true} reachable={status?.reachable ?? true} height="min(50vh, 480px)" />
    {/if}
  </div>
</section>
{/if}

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
