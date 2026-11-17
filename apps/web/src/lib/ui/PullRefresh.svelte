<script lang="ts">
  /**
   * Pull to refresh on a touch screen (spec 001), for every page of the shell and of every extension: at the
   * top of the page, pull down and let go to reload the page. iOS has none in a home-screen app, so the shell
   * draws its own: Pingo comes down under the header, a ring fills, and past the mark letting go reloads.
   * It stays out of the way: only a single finger at the very top of the page, only a mostly vertical pull
   * (a sideways swipe stays the Pager's), never from inside a sheet, a dialog, the chat, the terminal or a box
   * that is itself scrolled down, nor from an element marked `data-no-pull`.
   */
  import { onMount } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import { useT } from '#lib/i18n/index.ts';
  import { axisOf } from './swipe';
  import { armed, pullDistance, PULL_THRESHOLD } from './pull';

  const t = useT();
  let distance = $state(0);
  let busy = $state(false);
  let settling = $state(false);
  const ready = $derived(armed(distance));
  const progress = $derived(Math.min(1, distance / PULL_THRESHOLD));

  /** Whether a touch on this element may start a pull: nothing between it and the page scrolls or opts out. */
  function pullable(target: EventTarget | null): boolean {
    if (window.scrollY > 0) return false;
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return false;
    let el = target instanceof Element ? target : null;
    if (el?.closest('[data-no-pull], input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop > 0) return false;
    }
    return true;
  }

  onMount(() => {
    let start: { x: number; y: number } | null = null;
    let pulling = false;

    const reset = () => {
      start = null;
      pulling = false;
      settling = true;
      distance = 0;
    };
    const down = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || !pullable(e.target)) return (start = null);
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pulling = false;
      settling = false;
    };
    const moved = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) return reset();
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        const axis = axisOf(dx, dy);
        if (!axis) return;
        // Sideways is a swipe, upwards is scrolling, and the page may have scrolled meanwhile.
        if (axis === 'x' || dy < 0 || window.scrollY > 0) return reset();
        pulling = true;
      }
      // Our pull, not the browser's rubber band or its own pull to refresh.
      if (e.cancelable) e.preventDefault();
      distance = pullDistance(dy);
    };
    const up = () => {
      if (!start) return;
      const go = pulling && ready;
      start = null;
      pulling = false;
      settling = true;
      if (!go) return (distance = 0);
      busy = true;
      distance = PULL_THRESHOLD;
      // Pages that keep unsaved work save it on pagehide, which a reload fires.
      setTimeout(() => location.reload(), 120);
    };
    addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', moved, { passive: false });
    addEventListener('touchend', up, { passive: true });
    addEventListener('touchcancel', reset, { passive: true });
    return () => {
      removeEventListener('touchstart', down);
      removeEventListener('touchmove', moved);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', reset);
    };
  });
</script>

{#if distance > 0 || busy}
  <!-- A window just under the header: Pingo comes out from behind it, above the page's own sticky bars. -->
  <div class="clip">
    <div
      class="pull"
      class:settling
      class:ready
      class:busy
      style:--d="{distance}px"
      style:--p={progress}
      role="status"
      aria-live="polite">
      <span class="ring" aria-hidden="true"><Mascot mood={ready || busy ? 'charged' : 'steady'} size={30} decorative /></span>
      <span class="sr">{busy ? t('Refreshing…') : ready ? t('Release to refresh') : t('Pull down to refresh')}</span>
    </div>
  </div>
{/if}

<style>
  .clip {
    position: fixed;
    /* Just under the header (56 px, +layout.svelte). */
    top: 56px;
    left: 0;
    right: 0;
    height: 140px;
    z-index: 30;
    overflow: hidden;
    pointer-events: none;
  }
  .pull {
    position: absolute;
    top: 0;
    left: 50%;
    width: 44px;
    height: 44px;
    margin-left: -22px;
    pointer-events: none;
    transform: translateY(calc(var(--d) - 48px)) scale(calc(0.6 + var(--p) * 0.4));
    opacity: var(--p);
  }
  .pull.settling {
    transition:
      transform 0.25s ease,
      opacity 0.25s ease;
  }
  .ring {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background:
      radial-gradient(closest-side, var(--surface) calc(100% - 3px), transparent calc(100% - 2px)),
      conic-gradient(var(--accent) calc(var(--p) * 360deg), var(--sep) 0);
    box-shadow: var(--shadow-pop);
  }
  .ready .ring,
  .busy .ring {
    background:
      radial-gradient(closest-side, var(--surface) calc(100% - 3px), transparent calc(100% - 2px)),
      var(--accent);
  }
  @media (prefers-reduced-motion: no-preference) {
    .busy .ring {
      animation: hop 0.6s ease-in-out infinite alternate;
    }
  }
  :global([data-motion='reduce']) .busy .ring {
    animation: none;
  }
  @keyframes hop {
    to {
      transform: translateY(-4px);
    }
  }
</style>
