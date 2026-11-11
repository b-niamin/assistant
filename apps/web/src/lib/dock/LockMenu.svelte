<script lang="ts">
  /**
   * The lock in the header. Locked (the default): no terminal anywhere. A click asks for the app password
   * (the same 10-minute unlock as System settings) and the terminal's bar appears at the bottom of every
   * page. Unlocked: a click locks again, which also closes the terminal. Next to it, the updater's state
   * when it needs attention. The status comes from `GET /dock`, refreshed by the dock every 30 s.
   */
  import { tick } from 'svelte';
  import { dock, dockShown, lockSession, refreshDock, unlockSession } from './dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  const status = $derived(dock.status);
  const unlocked = $derived(dockShown());
  let menuOpen = $state(false);
  let menu = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function openMenu() {
    menuOpen = true;
    error = '';
    refreshDock();
    await tick();
    input?.focus();
  }

  // A page asked for the terminal (Sign in, Build it...) while locked.
  $effect(() => {
    if (dock.unlockAsked && !menuOpen) openMenu();
  });

  async function onButton() {
    if (unlocked) {
      busy = true;
      await lockSession();
      busy = false;
    } else if (menuOpen) close();
    else openMenu();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = await unlockSession(password, t('Could not unlock.'));
    busy = false;
    if (!error) {
      password = '';
      menuOpen = false;
    }
  }

  function close() {
    menuOpen = false;
    dock.unlockAsked = false;
    dock.queue = [];
  }

  function onWindowClick(e: MouseEvent) {
    if (menuOpen && menu && !menu.contains(e.target as Node)) close();
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && menuOpen && close()} />

{#if status?.update?.state === 'updating'}
  <a class="chip" href="/settings#up-h" title={t('Rebuilding: {actions}', { actions: status.update.actions })}>
    <span class="status small warning pulse">{t('Updating')}{status.update.steps ? ` ${status.update.step}/${status.update.steps}` : ''}</span>
  </a>
{:else if status?.update?.state === 'available'}
  <a class="chip" href="/settings#up-h" title={t('A new version ({sha}) is on GitHub: update it from System settings', { sha: status.update.sha })}>
    <span class="status small available">{t('Update')}</span>
  </a>
{:else if status?.update?.pendingRestart}
  <a class="chip" href="/settings#up-h" title={t('{services} runs the previous version: restart it from System settings', { services: status.update.pendingRestart })}>
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

<div class="lock" bind:this={menu}>
  <button
    class="lock-btn"
    class:open={unlocked}
    type="button"
    disabled={busy}
    aria-expanded={unlocked ? undefined : menuOpen}
    aria-controls={unlocked ? undefined : 'lock-menu'}
    title={unlocked ? t('Unlocked: the terminal is at the bottom. Click to lock.') : t('Locked. Click to unlock the terminal.')}
    onclick={onButton}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8.5" rx="2" />
      {#if unlocked}<path d="M7 9V6.5a3 3 0 0 1 5.8-1.1" />{:else}<path d="M7 9V6.5a3 3 0 0 1 6 0V9" />{/if}
      <circle cx="10" cy="13.2" r="1.1" class="dot" />
    </svg>
    <span class="sr">{unlocked ? t('Lock (hides the terminal)') : t('Unlock (shows the terminal)')}</span>
  </button>
  {#if menuOpen && !unlocked}
    <div class="menu card" id="lock-menu" role="dialog" aria-label={t('Unlock')}>
      {#if status && !status.configured}
        <p class="meta">{t('The terminal is not set up on this server yet.')}</p>
        <details class="tech"><summary>{t('Technical details')}</summary><span class="meta">{t('The terminal is off. Set SIDECAR_TICKET_SECRET in .env and run docker compose up -d.')}</span></details>
      {:else}
        <form onsubmit={submit}>
          <label for="lock-pw">{t('The terminal opens a shell, so it asks for the app password again.')}</label>
          <div class="row">
            <input id="lock-pw" bind:this={input} type="password" bind:value={password} autocomplete="current-password" placeholder={t('App password')} required />
            <button class="btn btn-primary" disabled={busy}>{t('Unlock')}</button>
          </div>
          {#if error}<p class="bad" role="alert">{error}</p>{/if}
        </form>
      {/if}
    </div>
  {/if}
</div>

<style>
  .lock {
    position: relative;
  }
  .lock-btn {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
  }
  .lock-btn:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .lock-btn.open {
    border-color: color-mix(in srgb, var(--hue-violet) 45%, var(--ring));
    background: color-mix(in srgb, var(--hue-violet) 12%, var(--surface));
    color: var(--hue-violet);
  }
  .lock-btn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .lock-btn .dot {
    fill: currentColor;
    stroke: none;
  }
  .chip {
    font-size: 0.8125rem;
    color: var(--ink-2);
    text-decoration: none;
    white-space: nowrap;
  }
  .chip:hover {
    color: var(--ink);
  }
  .chip .available::before {
    background: var(--accent);
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
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: min(360px, calc(100vw - 24px));
    padding: var(--space-3) var(--space-4);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 35%);
    z-index: 40;
  }
  .menu label,
  .menu .meta {
    display: block;
    margin: 0 0 var(--space-2);
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .bad {
    margin: var(--space-2) 0 0;
    color: var(--critical-ink);
    font-size: 0.8125rem;
  }
  @media (max-width: 560px) {
    .chip {
      display: none;
    }
    .menu {
      position: fixed;
      left: 12px;
      right: 12px;
      top: 64px;
      width: auto;
    }
  }
</style>
