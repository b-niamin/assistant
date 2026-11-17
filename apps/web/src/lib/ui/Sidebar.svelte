<script lang="ts">
  /**
   * The apps on a computer (spec 001, "Navigation"): a sidebar like macOS and iPadOS. Home, every app with
   * its icon, the pages of the open app under it (manifest "pages"), System settings at the bottom. Shown from
   * 1024px; narrower screens use the header's links (tablets) or the tab bar (phones).
   */
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import Mascot from '#lib/Mascot.svelte';
  import { extensionAt } from './nav.ts';
  import { useT } from '#lib/i18n/index.ts';
  import type { ExtensionInfo } from '#lib/extensions/types.ts';

  let { extensions }: { extensions: ExtensionInfo[] } = $props();
  const t = useT();
  const path = $derived(page.url.pathname.replace(/\/$/, '') || '/');
  const here = $derived(extensionAt(extensions, page.url.pathname));
  /** The page of the open app the path is on, or under (a workout is under Workout's app home). */
  const current = $derived.by(() => {
    if (!here) return null;
    const hit = [...here.pages].sort((a, b) => b.href.length - a.href.length).find((p) => path === p.href || path.startsWith(`${p.href}/`));
    return hit?.href ?? null;
  });
</script>

<nav class="sidebar" aria-label={t('Apps')}>
  <a class="brand" href="/" aria-label={t('Assistant, home')}>
    <Mascot mood="steady" size={28} decorative />
    <span>{t('Assistant')}</span>
  </a>
  <a class="item" href="/" aria-current={path === '/' ? 'page' : undefined}><Icon name="home" size={20} />{t('Home')}</a>
  {#if extensions.length}<p class="group">{t('Apps')}</p>{/if}
  {#each extensions as e (e.id)}
    <a class="item" href={e.href} aria-current={here?.id === e.id && (!e.pages.length || path === e.href) ? 'page' : undefined} class:open={here?.id === e.id}>
      <Icon name={e.icon ?? 'apps'} size={20} />{e.name}
    </a>
    {#if here?.id === e.id && e.pages.length}
      {#each e.pages as p (p.href)}
        <a class="item sub" href={p.href} aria-current={current === p.href ? 'page' : undefined}>{p.label}</a>
      {/each}
    {/if}
  {/each}
  <a class="item foot" href="/settings" aria-current={path.startsWith('/settings') ? 'page' : undefined}><Icon name="settings" size={20} />{t('System settings')}</a>
</nav>

<style>
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: var(--dock-h, 0px);
    z-index: 11;
    width: var(--sidebar-w, 248px);
    display: none;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3) var(--space-3) var(--space-4);
    overflow-y: auto;
    background: var(--surface);
    border-right: 1px solid var(--sep);
  }
  @media (min-width: 1024px) {
    .sidebar {
      display: flex;
    }
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-2);
    margin-bottom: var(--space-3);
    color: var(--ink);
    font-weight: var(--weight-heavy);
    text-decoration: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 38px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--ink);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .item :global(svg) {
    color: var(--accent-ink);
  }
  @media (hover: hover) {
    .item:hover {
      background: var(--fill-2);
    }
  }
  .item.open,
  .item[aria-current='page'] {
    background: var(--fill-1);
    font-weight: var(--weight-bold);
  }
  .item.sub {
    min-height: 34px;
    padding-left: calc(var(--space-3) + 20px + var(--space-3));
    font-size: var(--text-md);
    color: var(--ink-2);
    background: none;
    font-weight: var(--weight-medium);
  }
  .item.sub[aria-current='page'] {
    background: var(--accent-tint);
    color: var(--accent-ink);
    font-weight: var(--weight-bold);
  }
  .group {
    margin: var(--space-4) var(--space-3) var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .foot {
    margin-top: auto;
  }
</style>
