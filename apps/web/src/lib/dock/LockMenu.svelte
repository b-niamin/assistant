<script lang="ts">
  /**
   * The lock in the header: the app's one unlock. Locked (the default): Claude cannot act in the chat, there
   * is no terminal and System settings ask for the password. A click asks for the app password once for all
   * of them; the unlock lasts while the app is used (an hour without use locks it). Unlocked: the chat
   * button appears next to it, and a click locks again. Next to it, the updater's state when it needs
   * attention. The status comes from `GET /dock`, refreshed by the dock every 30 s.
   */
  import { tick } from 'svelte';
  import { dock, lockSession, refreshDock, unlocked as isUnlocked, unlockSession } from './dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  const status = $derived(dock.status);
  const unlocked = $derived(isUnlocked());
  let menuOpen = $state(false);
  let menu = $state<HTMLElement>();
  let input = $state<HTMLInputElement>();
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  /** When the prompt opened: the click that asked for it (a page's Unlock button) must not close it again. */
  let openedAt = 0;

  async function openMenu() {
    menuOpen = true;
    openedAt = performance.now();
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
    if (menuOpen && menu && !menu.contains(e.target as Node) && performance.now() - openedAt > 300) close();
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && menuOpen && close()} />

{#if status?.update?.state === 'updating'}
  <a class="chip" href="/settings/updates" title={t('Rebuilding: {actions}', { actions: status.update.actions })}>
    <span class="status small warning pulse">{t('Updating')}{status.update.steps ? ` ${status.update.step}/${status.update.steps}` : ''}</span>
  </a>
{:else if status?.update?.state === 'available'}
  <a class="chip" href="/settings/updates" title={t('A new version ({sha}) is on GitHub: update it from System settings', { sha: status.update.sha })}>
    <span class="status small available">{t('Update')}</span>
  </a>
{:else if status?.update?.pendingRestart}
  <a class="chip" href="/settings/updates" title={t('{services} runs the previous version: restart it from System settings', { services: status.update.pendingRestart })}>
    <span class="status small warning">{t('Restart needed')}</span>
  </a>
{:else if status?.update?.state === 'interrupted'}
  <a class="chip" href="/settings/updates" title={t("The update's process stopped; the updater resumes it, or resume it from System settings")}>
    <span class="status small warning">{t('Update interrupted')}</span>
  </a>
{:else if status?.update?.state === 'stale'}
  <a class="chip" href="/settings/updates" title={t('The updater has not run for a while: new commits are not deployed')}>
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
    title={unlocked ? t('Unlocked: the chat and System settings are open. Click to lock.') : t('Locked. Click to unlock the chat and System settings.')}
    onclick={onButton}
  >
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8.5" rx="2" />
      {#if unlocked}<path d="M7 9V6.5a3 3 0 0 1 5.8-1.1" />{:else}<path d="M7 9V6.5a3 3 0 0 1 6 0V9" />{/if}
      <circle cx="10" cy="13.2" r="1.1" class="dot" />
    </svg>
    {#if unlocked}<span class="ltext" aria-hidden="true">{t('Unlocked')}</span>{/if}
    <span class="sr">{unlocked ? t('Lock') : t('Unlock')}</span>
  </button>
  {#if menuOpen && !unlocked}
    <div class="menu card" id="lock-menu" role="dialog" aria-label={t('Unlock')}>
      <form onsubmit={submit}>
        <label for="lock-pw">{t('Claude in the chat and System settings act with full access, so they ask for the app password again. It stays unlocked while you use the app.')}</label>
        <div class="row">
          <input id="lock-pw" bind:this={input} type="password" bind:value={password} autocomplete="current-password" placeholder={t('App password')} required />
          <button class="btn btn-primary" disabled={busy}>{t('Unlock')}</button>
        </div>
        {#if error}<p class="bad" role="alert">{error}</p>{/if}
      </form>
    </div>
  {/if}
</div>

<style>
  .lock {
    position: relative;
  }
  .lock-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 36px;
    height: 36px;
    padding: 0 8px;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
  }
  @media (hover: hover) {
    .lock-btn:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
  }
  .lock-btn.open {
    padding: 0 12px 0 10px;
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
    font-size: var(--text-sm);
    color: var(--ink-2);
    text-decoration: none;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .chip:hover {
      color: var(--ink);
    }
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
  .menu label {
    display: block;
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
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
    font-size: var(--text-sm);
  }
  @media (max-width: 720px) {
    .ltext {
      display: none;
    }
    .lock-btn.open {
      padding: 0 8px;
    }
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
