<script lang="ts">
  /**
   * The head of every page (spec 001, "Navigation"): Pingo, a large title, one line under it and actions
   * on the right. On an extension's own pages (manifest "pages") the shell's page navigation follows
   * under it: one glass segmented control, the same in every extension. A page further in (a workout, a
   * plan) passes `back` instead: a back button with the parent's name. `focus` hides the tab bar while the
   * page is open (a workout in progress).
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Mascot from '#lib/Mascot.svelte';
  import Icon from './Icon.svelte';
  import { useT } from '#lib/i18n/index.ts';
  import { pagesOf } from './nav.ts';
  import type { Accessory, Mood } from '#lib/mascot.ts';
  import type { ExtensionInfo } from '#lib/extensions/types.ts';

  let {
    title,
    sub = '',
    mood = 'steady',
    accessory,
    mascot = true,
    back,
    focus = false,
    lede,
    actions
  }: {
    title: string;
    /** One line under the title (a date, a state). */
    sub?: string;
    mood?: Mood;
    /** What Pingo wears; by default the page's own (manifest "accessory"). */
    accessory?: Accessory | 'auto';
    /** false: no Pingo (the page has its own, bigger one). */
    mascot?: boolean;
    /** A page further in: where back goes and its name. */
    back?: { href: string; label: string };
    focus?: boolean;
    /** Richer content under the title instead of `sub`. */
    lede?: Snippet;
    actions?: Snippet;
  } = $props();
  const t = useT();
  const nav = $derived(back ? null : pagesOf((page.data.extensions ?? []) as ExtensionInfo[], page.url.pathname));

  onMount(() => {
    if (!focus) return;
    document.documentElement.dataset.focus = '';
    return () => delete document.documentElement.dataset.focus;
  });
</script>

<div class="pagehead">
  {#if back}
    <a class="btn-glass back" href={back.href} aria-label={t('Back to {page}', { page: back.label })}>
      <Icon name="back" size={20} /><span>{back.label}</span>
    </a>
  {/if}
  <div class="row">
    {#if mascot && !back}<span class="pingo"><Mascot {mood} {accessory} size={52} decorative /></span>{/if}
    <div class="text">
      <h1>{title}</h1>
      {#if lede}<div class="sub">{@render lede()}</div>{:else if sub}<p class="sub">{sub}</p>{/if}
    </div>
    {#if actions}<div class="acts">{@render actions()}</div>{/if}
  </div>
  {#if nav}
    <nav class="pagenav" aria-label={t('{app} pages', { app: nav.ext.name })}>
      <div class="segmented glass full">
        {#each nav.pages as p (p.href)}
          <a href={p.href} aria-current={p.href === nav.current ? 'page' : undefined}>
            {#if p.icon}<Icon name={p.icon} size={18} />{/if}{p.label}
          </a>
        {/each}
      </div>
    </nav>
  {/if}
</div>

<style>
  .pagehead {
    margin-bottom: var(--space-5);
  }
  .back {
    height: 40px;
    padding: 0 var(--space-4) 0 var(--space-2);
    margin-bottom: var(--space-3);
    gap: 2px;
    font-weight: var(--weight-medium);
    max-width: 100%;
  }
  .back span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .pingo {
    flex: none;
    display: inline-flex;
    margin: -4px 0;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--weight-heavy);
    letter-spacing: -0.02em;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .sub {
    margin: 2px 0 0;
    color: var(--ink-3);
    font-size: var(--text-md);
  }
  .acts {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* The page navigation stays in reach while the page scrolls, just under the app's header. */
  .pagenav {
    position: sticky;
    top: calc(var(--header-h, 56px) + var(--space-2));
    z-index: 5;
    margin-top: var(--space-4);
  }
  .pagenav :global(.segmented) {
    max-width: 560px;
  }
  /* A computer: the sidebar lists the app's pages instead. */
  @media (min-width: 1024px) {
    .pagenav {
      display: none;
    }
  }
  /* A phone: words only, so three or four pages fit side by side. */
  @media (max-width: 480px) {
    .pagenav :global(.segmented svg) {
      display: none;
    }
    .pagenav :global(.segmented > a) {
      padding: 0 var(--space-2);
    }
  }
</style>
