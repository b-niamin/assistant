<script lang="ts">
  /**
   * The apps on a phone (spec 001, "Navigation"): a floating glass tab bar at the bottom with the dashboard,
   * the first apps in nav order and More (every app and System settings, in a sheet). Hidden on wider
   * screens (the header has the apps) and while a page is in focus mode (PageHead `focus`).
   */
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import { tabsOf, extensionAt } from './nav.ts';
  import { useT } from '#lib/i18n/index.ts';
  import type { ExtensionInfo } from '#lib/extensions/types.ts';

  let { extensions }: { extensions: ExtensionInfo[] } = $props();
  const t = useT();
  const tabs = $derived(tabsOf(extensions));
  const here = $derived(extensionAt(extensions, page.url.pathname));
  const inMore = $derived(!!here && !tabs.shown.includes(here));
  let more = $state(false);
  $effect(() => {
    page.url.pathname;
    more = false;
  });
</script>

<nav class="tabbar glass" aria-label={t('Apps')}>
  <a href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}><Icon name="home" size={24} /><span>{t('Home')}</span></a>
  {#each tabs.shown as e (e.id)}
    <a href={e.href} aria-current={here?.id === e.id ? 'page' : undefined}><Icon name={e.icon ?? 'apps'} size={24} /><span>{e.short ?? e.name}</span></a>
  {/each}
  {#if tabs.more}
    <button type="button" aria-current={inMore ? 'page' : undefined} aria-expanded={more} onclick={() => (more = true)}>
      <Icon name="more" size={24} /><span>{t('More')}</span>
    </button>
  {/if}
</nav>

{#if more}
  <Sheet title={t('Apps')} onclose={() => (more = false)}>
    <div class="list-group">
      {#each extensions as e (e.id)}
        <a class="list-row" href={e.href}>
          <span class="list-icon"><Icon name={e.icon ?? 'apps'} size={18} /></span>
          <span class="list-text"><span class="list-title">{e.name}</span></span>
        </a>
      {/each}
    </div>
    <div class="list-group" style:margin-top="var(--space-4)">
      <a class="list-row" href="/settings">
        <span class="list-icon" style:--c="var(--ink-3)"><Icon name="settings" size={18} /></span>
        <span class="list-text"><span class="list-title">{t('System settings')}</span></span>
      </a>
    </div>
  </Sheet>
{/if}

<style>
  .tabbar {
    position: fixed;
    left: max(12px, env(safe-area-inset-left, 0px));
    right: max(12px, env(safe-area-inset-right, 0px));
    bottom: calc(10px + var(--dock-h, 0px) + env(safe-area-inset-bottom, 0px));
    z-index: 30;
    max-width: 520px;
    margin: 0 auto;
    display: flex;
    gap: 2px;
    height: 64px;
    padding: 5px;
    border-radius: var(--radius-lg);
  }
  .tabbar > :is(a, button) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0 2px;
    border: 0;
    border-radius: 24px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: var(--weight-bold);
    text-decoration: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .tabbar span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tabbar [aria-current='page'] {
    color: var(--accent-ink);
    background: var(--fill-1);
  }
  @media (min-width: 701px) {
    .tabbar {
      display: none;
    }
  }
  :global(html[data-focus]) .tabbar {
    display: none;
  }
</style>
