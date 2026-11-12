<script lang="ts">
  /**
   * The user menu at the right end of the header: the profile's initial in its own colour (and its name
   * on wide screens). It leads to Profile settings and System settings, switches profiles (POST /profile),
   * picks the theme and the language for this browser, and logs out. Reduced motion lives in Profile
   * settings -> Appearance.
   */
  import { page } from '$app/state';
  import type { Theme } from '#lib/theme.ts';
  import { hueFor, initials } from '#lib/settings/guide.ts';
  import { setLanguage, setTheme } from './prefs.ts';
  import { useT } from '#lib/i18n/index.ts';

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
  const others = $derived(profiles.filter((p) => p.id !== profileId));

  const THEMES: { id: Theme; label: string; icon: string[] }[] = $derived([
    { id: 'light', label: t('Light'), icon: ['M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1'] },
    { id: 'dark', label: t('Dark'), icon: ['M16 12.2A6.5 6.5 0 0 1 7.8 4a6.5 6.5 0 1 0 8.2 8.2z'] },
    { id: 'system', label: t('System'), icon: ['M3 4.5h14v9H3z', 'M7.5 16.5h5M10 13.5v3'] }
  ]);

  function pickTheme(th: Theme) {
    picked = th;
    setTheme(th);
  }

  function onWindowClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  const here = (href: string) => page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="user" bind:this={root}>
  <button class="trigger" type="button" aria-expanded={open} aria-controls="user-menu" title={name} onclick={() => (open = !open)}>
    <span class="avatar" style="--hue: {hueFor(profileId)}" aria-hidden="true">{initials(name)}</span>
    <span class="tname" aria-hidden="true">{name}</span>
    <svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
    <span class="sr">{t('Profile: {name}', { name })}</span>
  </button>
  {#if open}
    <div class="menu card" id="user-menu" role="region" aria-label={t('Profile menu')}>
      <a class="who" href="/settings/profile" onclick={() => (open = false)}>
        <span class="avatar big" style="--hue: {hueFor(profileId)}" aria-hidden="true">{initials(name)}</span>
        <span class="whotext">
          <strong>{name}</strong>
          <span class="meta">{t('Profile')} · {profileId}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>

      <nav class="links" aria-label={t('Settings')}>
        <a class="item" href="/settings/profile" aria-current={here('/settings/profile') ? 'page' : undefined} onclick={() => (open = false)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" /><path d="M3.5 17c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5" /></svg>
          {t('Profile settings')}
        </a>
        <a class="item" href="/settings/profile#mcp-h" onclick={() => (open = false)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3.9 6.5l12.2 7M3.9 13.5l12.2-7" /></svg>
          {t('Claude and MCP')}
        </a>
        <a class="item" href="/settings" aria-current={here('/settings') && !here('/settings/profile') ? 'page' : undefined} onclick={() => (open = false)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></svg>
          {t('System settings')}
        </a>
      </nav>

      <hr />
      {#if others.length}<p class="label">{t('Switch profile')}</p>{/if}
      <ul>
        {#each others as p (p.id)}
          <li>
            <form method="POST" action="/profile">
              <input type="hidden" name="profile" value={p.id} />
              <button class="item">
                <span class="avatar small" style="--hue: {hueFor(p.id)}" aria-hidden="true">{initials(p.name)}</span>
                {p.name}
              </button>
            </form>
          </li>
        {/each}
        <li>
          <a class="item" href="/settings/profiles#add" onclick={() => (open = false)}>
            <span class="avatar small plus" aria-hidden="true">+</span>
            {others.length ? t('Add or edit profiles…') : t('Add a person')}
          </a>
        </li>
      </ul>

      <hr />
      <div class="look">
        <div class="icons" role="radiogroup" aria-label={t('Theme')}>
          {#each THEMES as th (th.id)}
            <button type="button" role="radio" aria-checked={current === th.id} class:on={current === th.id} title={th.label} onclick={() => pickTheme(th.id)}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{#each th.icon as d}<path {d} />{/each}</svg>
              <span class="sr">{th.label}</span>
            </button>
          {/each}
        </div>
        {#if languages.length > 1}
          <div class="langs" role="radiogroup" aria-label={t('Language')}>
            {#each languages as l (l.code)}
              <button type="button" role="radio" lang={l.code} aria-checked={lang === l.code} class:on={lang === l.code} title={l.name} onclick={() => l.code !== lang && setLanguage(l.code)}>
                {l.code.toUpperCase()}
                <span class="sr">{l.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <hr />
      <form method="POST" action="/logout">
        <button class="item">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H4.5v12H8M12 6.5L15.5 10 12 13.5M15.5 10H8" /></svg>
          {t('Log out')}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  .user {
    position: relative;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 2px 10px 2px 2px;
    border: 1px solid var(--ring);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    background: var(--surface-2);
  }
  .tname {
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .caret {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--ink-3);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--hue) 20%, var(--surface));
    color: var(--hue);
    font-size: var(--text-sm);
    font-weight: 700;
    line-height: 1;
  }
  .avatar.big {
    width: 42px;
    height: 42px;
    font-size: var(--text-base);
  }
  .avatar.small {
    width: 24px;
    height: 24px;
    font-size: 0.6875rem;
  }
  .avatar.plus {
    background: none;
    border: 1.5px dashed var(--axis);
    color: var(--ink-2);
    box-sizing: border-box;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 280px;
    padding: var(--space-2);
    box-shadow: 0 16px 40px -16px rgb(0 0 0 / 40%);
    z-index: 40;
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    color: inherit;
    text-decoration: none;
  }
  .who:hover {
    background: var(--surface-2);
  }
  .whotext {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .whotext strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    color: var(--ink-4);
    font-size: 1.25rem;
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--ink-2);
  }
  .links {
    display: grid;
    margin-top: var(--space-1);
  }
  .label {
    margin: var(--space-1) var(--space-2) var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
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
    gap: var(--space-3);
    width: 100%;
    padding: 7px var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item[aria-current='page'] {
    font-weight: var(--weight-bold);
  }
  .item svg,
  .icons svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .item svg {
    color: var(--ink-3);
  }
  hr {
    margin: var(--space-2) 0;
    border: 0;
    border-top: 1px solid var(--ring);
  }
  .look {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }
  .icons,
  .langs {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .icons button,
  .langs button {
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 28px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    cursor: pointer;
  }
  .icons button.on,
  .langs button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 15%);
  }
  @media (max-width: 720px) {
    .tname,
    .caret {
      display: none;
    }
    .trigger {
      padding: 2px;
    }
  }
</style>
