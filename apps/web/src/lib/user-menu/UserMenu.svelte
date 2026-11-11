<script lang="ts">
  /**
   * The user menu at the right end of the header: a round badge with the profile's initial. It shows
   * the profile's full name, switches profiles (POST /profile), picks the theme and the language, and leads to
   * System settings and Log out.
   */
  import { page } from '$app/state';
  import { THEME_COOKIE, type Theme } from '#lib/theme.ts';
  import { LANG_COOKIE, useT } from '#lib/i18n/index.ts';

  let {
    profiles,
    profileId,
    theme,
    lang,
    languages
  }: {
    profiles: { id: string; name: string }[];
    profileId: string;
    theme: Theme;
    lang: string;
    languages: { code: string; name: string }[];
  } = $props();
  const t = useT();

  let open = $state(false);
  let root = $state<HTMLElement>();
  // The server's value until the owner picks another one here.
  let picked = $state<Theme | null>(null);
  const current = $derived(picked ?? theme);

  const me = $derived(profiles.find((p) => p.id === profileId));
  const name = $derived(me?.name ?? profileId);
  const initial = $derived((name.trim()[0] ?? '?').toUpperCase());
  const others = $derived(profiles.filter((p) => p.id !== profileId));

  const THEMES: { id: Theme; label: string }[] = $derived([
    { id: 'light', label: t('Light') },
    { id: 'dark', label: t('Dark') },
    { id: 'system', label: t('System') }
  ]);

  /** Remembered in this browser (spec 007); the page reloads so every text, app and date follows. */
  function setLang(code: string) {
    if (code === lang) return;
    document.cookie = `${LANG_COOKIE}=${code};path=/;max-age=${365 * 24 * 3600};samesite=lax${location.protocol === 'https:' ? ';secure' : ''}`;
    location.reload();
  }

  function setTheme(t: Theme) {
    picked = t;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    const age = t === 'system' ? 0 : 365 * 24 * 3600;
    document.cookie = `${THEME_COOKIE}=${t};path=/;max-age=${age};samesite=lax${location.protocol === 'https:' ? ';secure' : ''}`;
  }

  function onWindowClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="user" bind:this={root}>
  <button class="avatar" type="button" aria-expanded={open} aria-controls="user-menu" title={name} onclick={() => (open = !open)}>
    <span aria-hidden="true">{initial}</span>
    <span class="sr">{t('Profile: {name}', { name })}</span>
  </button>
  {#if open}
    <div class="menu card" id="user-menu" role="region" aria-label={t('Profile menu')}>
      <div class="who">
        <span class="avatar big" aria-hidden="true">{initial}</span>
        <span>
          <strong>{name}</strong>
          <span class="meta">{t('Profile')}</span>
        </span>
      </div>

      {#if others.length}
        <p class="label">{t('Switch profile')}</p>
        <ul>
          {#each others as p (p.id)}
            <li>
              <form method="POST" action="/profile">
                <input type="hidden" name="profile" value={p.id} />
                <button class="item">
                  <span class="avatar small" aria-hidden="true">{(p.name.trim()[0] ?? '?').toUpperCase()}</span>
                  {p.name}
                </button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
      <a class="item" href="/settings/profiles" onclick={() => (open = false)}>{t('Add or edit profiles…')}</a>

      <hr />
      <p class="label" id="theme-label">{t('Theme')}</p>
      <div class="seg" role="radiogroup" aria-labelledby="theme-label">
        {#each THEMES as th (th.id)}
          <button type="button" role="radio" aria-checked={current === th.id} class:on={current === th.id} onclick={() => setTheme(th.id)}>{th.label}</button>
        {/each}
      </div>

      {#if languages.length > 1}
        <p class="label" id="lang-label">{t('Language')}</p>
        <div class="seg" role="radiogroup" aria-labelledby="lang-label">
          {#each languages as l (l.code)}
            <button type="button" role="radio" lang={l.code} aria-checked={lang === l.code} class:on={lang === l.code} onclick={() => setLang(l.code)}>{l.name}</button>
          {/each}
        </div>
      {/if}

      <hr />
      <a class="item" href="/settings" aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined} onclick={() => (open = false)}>{t('System settings')}</a>
      <form method="POST" action="/logout"><button class="item">{t('Log out')}</button></form>
    </div>
  {/if}
</div>

<style>
  .user {
    position: relative;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 650;
    line-height: 1;
    cursor: pointer;
  }
  button.avatar:hover,
  button.avatar[aria-expanded='true'] {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .avatar.big {
    width: 40px;
    height: 40px;
    font-size: 1.125rem;
    flex: none;
  }
  .avatar.small {
    width: 22px;
    height: 22px;
    font-size: 0.6875rem;
    background: var(--surface-2);
    color: var(--ink-2);
    flex: none;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 260px;
    padding: var(--space-2);
    box-shadow: 0 12px 32px -12px rgb(0 0 0 / 35%);
    z-index: 40;
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
  }
  .who > span:last-child {
    display: grid;
    min-width: 0;
  }
  .who strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .label {
    margin: var(--space-2) var(--space-2) var(--space-1);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  form {
    margin: 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 7px var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 0.875rem;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item[aria-current='page'] {
    font-weight: 600;
  }
  hr {
    margin: var(--space-2) 0;
    border: 0;
    border-top: 1px solid var(--ring);
  }
  .seg {
    display: flex;
    gap: 2px;
    margin: 0 var(--space-2) var(--space-1);
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    flex-wrap: wrap;
  }
  .seg button {
    flex: 1 1 30%;
    padding: 5px 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 15%);
  }
</style>
