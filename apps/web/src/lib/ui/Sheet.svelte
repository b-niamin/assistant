<script lang="ts">
  /**
   * A bottom sheet (a centred window on a computer, spec 001): a title, a round close button, an optional
   * fixed head and action, and a body that scrolls. Escape and the backdrop close it. `full` takes the whole
   * screen on a phone (a long list, a timer).
   */
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let {
    title = '',
    full = false,
    onclose,
    head,
    action,
    children
  }: { title?: string; full?: boolean; onclose: () => void; head?: Snippet; action?: Snippet; children: Snippet } = $props();
  const t = useT();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 960px)').matches;
  let body = $state<HTMLDivElement>();
  /** Back to the top of the body (a new step in the same sheet). */
  export function scrollTop() {
    body?.scrollTo(0, 0);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />
<div class="sheet-bg" role="presentation" onclick={onclose} transition:fade={{ duration: reduced ? 0 : 200 }}></div>
<div
  class="sheet"
  class:full
  role="dialog"
  aria-modal="true"
  aria-label={title || t('Details')}
  transition:fly={{ y: wide ? 20 : 600, duration: reduced ? 0 : 300, opacity: wide ? 0 : 1 }}>
  <div class="grab" aria-hidden="true"></div>
  <div class="top">
    <h2>{title}</h2>
    {#if action}{@render action()}{/if}
    <button class="btn btn-icon btn-sm" type="button" onclick={onclose} aria-label={t('Close')}><Icon name="close" size={18} /></button>
  </div>
  {#if head}<div class="head">{@render head()}</div>{/if}
  <div class="body" bind:this={body}>{@render children()}</div>
</div>

<style>
  .sheet-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 60;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 90dvh;
    z-index: 61;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    color: var(--ink);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-pop);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .sheet.full {
    height: 100dvh;
    max-height: none;
    border-radius: 0;
    padding-top: env(safe-area-inset-top, 0px);
  }
  .grab {
    flex: none;
    width: 38px;
    height: 5px;
    margin: 8px auto 0;
    border-radius: 3px;
    background: var(--fill-1);
  }
  .top,
  .head,
  .body {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }
  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
  }
  .top h2 {
    flex: 1;
    min-width: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
  }
  .head {
    flex: none;
    padding-bottom: var(--space-2);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: var(--space-6);
  }
  @media (min-width: 960px) {
    .sheet,
    .sheet.full {
      left: 50%;
      right: auto;
      top: 50%;
      bottom: auto;
      width: min(640px, calc(100vw - 48px));
      height: auto;
      max-height: 86vh;
      border-radius: var(--radius-lg);
      transform: translate(-50%, -50%);
      overflow: hidden;
      padding-top: 0;
    }
    .grab {
      display: none;
    }
  }
</style>
