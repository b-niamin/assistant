<script lang="ts">
  import '../app.css';
  import Mascot from '#lib/Mascot.svelte';
  import Dock from '#lib/dock/Dock.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  let { data, children } = $props();

  /** The profile menu also leads to managing profiles; picking that entry navigates instead of switching. */
  function onProfile(e: Event & { currentTarget: HTMLSelectElement }) {
    const sel = e.currentTarget;
    if (sel.value === '__manage') {
      sel.value = data.profileId;
      goto('/settings/profiles');
    } else (sel.form as HTMLFormElement).requestSubmit();
  }
</script>

<svelte:head><title>Assistant</title></svelte:head>

{#if data.authenticated}
  <header>
    <div class="bar">
      <a class="brand" href="/" aria-label="Assistant, home">
        <span class="mark"><Mascot mood="steady" size={30} decorative /></span>
        <span>Assistant</span>
      </a>
      <nav aria-label="Extensions">
        {#each data.extensions as m}
          <a href={m.href} aria-current={page.url.pathname.startsWith(m.href) ? 'page' : undefined}>{m.name}</a>
        {/each}
      </nav>
      <div class="right">
        <form method="POST" action="/profile">
          <label>
            <span class="sr">Profile</span>
            <select name="profile" onchange={onProfile}>
              {#each data.profiles as p}
                <option value={p.id} selected={p.id === data.profileId}>{p.name}</option>
              {/each}
              <option disabled>──────</option>
              <option value="__manage">Add or edit profiles…</option>
            </select>
          </label>
          <noscript><button class="btn">Switch</button></noscript>
        </form>
        <a class="settings" href="/settings" aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}>Settings</a>
        <form method="POST" action="/logout"><button class="btn-ghost">Log out</button></form>
      </div>
    </div>
  </header>
{/if}

<main class:docked={data.authenticated}>{@render children()}</main>

{#if data.authenticated}<Dock />{/if}

<style>
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
    font-size: 0.9375rem;
    white-space: nowrap;
  }
  nav a:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  nav a[aria-current='page'] {
    color: var(--ink);
    font-weight: 600;
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
  .right form {
    margin: 0;
  }
  .settings {
    color: var(--ink-2);
    text-decoration: none;
    font-size: 0.9375rem;
  }
  .settings[aria-current='page'] {
    color: var(--ink);
    font-weight: 600;
  }
  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4) var(--space-7);
  }
  /* Room for the dock's bar at the bottom. */
  main.docked {
    padding-bottom: calc(var(--space-7) + 48px);
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
