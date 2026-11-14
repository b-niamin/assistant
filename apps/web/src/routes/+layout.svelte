<script lang="ts">
  import '../app.css';
  import Mascot from '#lib/Mascot.svelte';
  import Dock from '#lib/dock/Dock.svelte';
  import LockMenu from '#lib/dock/LockMenu.svelte';
  import ChatPanel from '#lib/chat/ChatPanel.svelte';
  import { chatPanel, closeChat, openChat } from '#lib/chat/panel.svelte.ts';
  import { dock, dockVisible, unlocked } from '#lib/dock/dock.svelte.ts';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import UserMenu from '#lib/user-menu/UserMenu.svelte';
  import { navigating, page } from '$app/state';
  import { provideLanguage, useT } from '#lib/i18n/index.ts';
  let { data, children } = $props();
  provideLanguage(() => data.lang);
  const t = useT();
  $effect.pre(() => {
    dock.enabled = data.terminal;
  });
  // An old /chat link lands here with ?chat (and the conversation): open the panel, tidy the address.
  $effect(() => {
    if (!data.authenticated || !page.url.searchParams.has('chat')) return;
    const url = new URL(page.url.href);
    untrack(() => openChat(url.searchParams.get('chat') ?? ''));
    url.searchParams.delete('chat');
    goto(url, { replace: true, reset: false });
  });
  // The first-run wizard is a page of its own: no header (the dock stays, it installs the apps).
  const wizard = $derived(page.url.pathname === '/setup' || page.url.pathname.startsWith('/setup/'));

  // A thin bar at the top while a page loads, shown only after 150 ms so quick ones do not flicker.
  let loading = $state(false);
  $effect(() => {
    if (!navigating.to) {
      loading = false;
      return;
    }
    const timer = setTimeout(() => (loading = true), 150);
    return () => clearTimeout(timer);
  });
</script>

<svelte:head><title>{t('Assistant')}</title></svelte:head>

{#if loading}<div class="loading" role="progressbar" aria-label={t('Loading')}></div>{/if}

<a class="skip" href="#main">{t('Skip to content')}</a>

{#if data.authenticated && !wizard}
  <!-- While the terminal is open the page behind it is out of reach for Tab and screen readers too. -->
  <header inert={dock.open && dockVisible()}>
    <div class="bar">
      <a class="brand" href="/" aria-label={t('Assistant, home')}>
        <span class="mark"><Mascot mood="steady" size={30} decorative /></span>
        <span>{t('Assistant')}</span>
      </a>
      <nav aria-label={t('Extensions')}>
        {#each data.extensions as m}
          <a href={m.href} aria-current={page.url.pathname.startsWith(m.href) ? 'page' : undefined}>{m.name}</a>
        {/each}
      </nav>
      <div class="right">
        <LockMenu />
        {#if unlocked()}
          <button type="button" class="chatbtn" class:on={chatPanel.open} aria-expanded={chatPanel.open} title={t('Chat with Claude')}
            onclick={() => (chatPanel.open ? closeChat() : openChat())}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12v8.5H9l-3.5 3v-3H4z" /></svg>
            <span class="sr">{t('Chat with Claude')}</span>
          </button>
        {/if}
        <UserMenu profiles={data.profiles} profileId={data.profileId} theme={data.theme} lang={data.lang} languages={data.languages} terminal={data.terminal} />
      </div>
    </div>
  </header>
{/if}

<main id="main" tabindex="-1" class:docked={data.authenticated && dockVisible()} inert={data.authenticated && dock.open && dockVisible()}>{@render children()}</main>

{#if data.authenticated}<Dock />{/if}
{#if data.authenticated && chatPanel.mounted}<ChatPanel docked={dockVisible()} />{/if}

<style>
  .loading {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 200;
    background: var(--accent);
    transform-origin: left;
  }
  @media (prefers-reduced-motion: no-preference) {
    .loading {
      animation: grow 8s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
    }
  }
  @keyframes grow {
    from {
      transform: scaleX(0.05);
    }
    to {
      transform: scaleX(0.9);
    }
  }
  .skip {
    position: absolute;
    left: var(--space-3);
    top: -100px;
    z-index: 100;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--ring);
  }
  .skip:focus {
    top: var(--space-2);
  }
  main:focus {
    outline: none;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--ring);
  }
  .bar {
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-5);
    height: 56px;
    padding: 0 var(--space-4);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink);
    text-decoration: none;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .mark {
    display: inline-flex;
    margin: -4px 0;
  }
  nav {
    display: flex;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  nav a {
    position: relative;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    color: var(--ink-2);
    text-decoration: none;
    font-size: var(--text-base);
    white-space: nowrap;
  }
  @media (hover: hover) {
    nav a:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
  }
  nav a[aria-current='page'] {
    color: var(--ink);
    font-weight: var(--weight-bold);
  }
  nav a[aria-current='page']::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -13px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .chatbtn {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-2);
    cursor: pointer;
  }
  .chatbtn.on {
    border-color: color-mix(in srgb, var(--hue-violet) 45%, var(--ring));
    background: color-mix(in srgb, var(--hue-violet) 12%, var(--surface));
    color: var(--hue-violet);
  }
  @media (hover: hover) {
    .chatbtn:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
  }
  .chatbtn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
  }
  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-7);
  }
  /* Room for the dock's bar at the bottom. */
  main.docked {
    /* The dock bar's height (Dock.svelte .strip, 1px border, the phone's safe area). */
    --dock-h: calc(41px + env(safe-area-inset-bottom, 0px));
    padding-bottom: calc(var(--space-7) + 48px);
  }
  /* A onefile app fills the page down to the dock bar instead of running under it. */
  main.docked:has(:global(.onefile-host)) {
    padding-bottom: var(--space-7);
  }
  @media (max-width: 560px) {
    .bar {
      gap: var(--space-3);
    }
    .brand > span:last-child {
      display: none;
    }
    main {
      padding-top: var(--space-5);
    }
  }
</style>
