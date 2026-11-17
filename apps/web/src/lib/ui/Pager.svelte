<script lang="ts">
  /**
   * Pages through ordered periods (a week, a month, ...) by swiping (spec 001, "Pager"): a finger moving
   * left shows the next page, right the previous one. The page follows the finger, a mostly vertical move
   * scrolls the page as usual, and a swipe from the screen's very edge is left to the browser (back). The
   * head (a title, the period's name) stays put and carries round previous/next buttons for a mouse and a
   * keyboard; ArrowLeft/ArrowRight work while focus is inside. The page slides in when `key` changes, in
   * the direction of the change, so buttons, links and the browser's back slide too. Less motion: no slide.
   *
   * onprev/onnext do the paging (usually `goto` with the new period) and should return its promise: the
   * page waits for it, and slides back when it ends without a new `key`.
   */
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { useT } from '#lib/i18n/index.ts';
  import { reducedMotion } from '#lib/motion.ts';
  import { axisOf, dragOffset, swipeResult } from './swipe.ts';

  let {
    key,
    onprev,
    onnext,
    hasPrev = true,
    hasNext = true,
    label = '',
    prevLabel = '',
    nextLabel = '',
    head,
    actions,
    children
  }: {
    /** The page shown; keys sort in page order (a date, a number). */
    key: string | number;
    onprev: () => unknown;
    onnext: () => unknown;
    hasPrev?: boolean;
    hasNext?: boolean;
    /** What is paged through, for screen readers, e.g. "Weeks". */
    label?: string;
    prevLabel?: string;
    nextLabel?: string;
    /** Left of the buttons: the period's name. */
    head?: Snippet;
    /** Between the head and the buttons, e.g. a "Today" pill. */
    actions?: Snippet;
    children: Snippet;
  } = $props();
  const t = useT();
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

  let root = $state<HTMLDivElement>();
  let body = $state<HTMLDivElement>();
  let dragging = $state(false);
  let last: string | number | undefined;
  /** The page on its way out after a swipe, until the new one arrives. */
  let out: Animation | null = null;
  let outX = 0;

  const move = (x: number) => `translateX(${x}px)`;

  /** The new page slides in from the side it was asked from. */
  function enter(dir: 1 | -1) {
    const from = out ? -outX : dir * 32;
    out?.cancel();
    out = null;
    if (!body || reducedMotion()) return;
    body.animate([{ transform: move(from), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
  }

  $effect(() => {
    const k = key;
    if (last === undefined || k === last) {
      last = k;
      return;
    }
    const dir = (typeof k === 'number' && typeof last === 'number' ? k > last : String(k) > String(last)) ? 1 : -1;
    last = k;
    enter(dir);
  });

  async function go(dir: 'prev' | 'next', from = 0) {
    if (dir === 'prev' ? !hasPrev : !hasNext) return;
    const k = key;
    if (body && !reducedMotion()) {
      outX = (dir === 'next' ? -1 : 1) * Math.round(body.clientWidth * 0.35);
      if (from) {
        out = body.animate([{ transform: move(from), opacity: 1 }, { transform: move(outX), opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
      }
    }
    try {
      await (dir === 'prev' ? onprev() : onnext());
    } finally {
      // Nothing new came (an error, the same page): the old page comes back.
      if (key === k && out && body) {
        out.cancel();
        out = null;
        body.animate([{ transform: move(outX), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: EASE });
      }
    }
  }

  // Pointer events on the whole pager (head and page). Listeners are added here, not as attributes:
  // the pager is a region, not a control, and its controls are the buttons.
  $effect(() => {
    const el = root;
    if (!el) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let dx = 0;
    let swallow = false;

    const reset = () => {
      start = null;
      axis = null;
      dragging = false;
      if (body) body.style.transform = '';
    };
    const back = () => {
      const x = dragOffset(dx, hasPrev, hasNext);
      reset();
      if (x && body && !reducedMotion()) body.animate([{ transform: move(x) }, { transform: 'none' }], { duration: 200, easing: EASE });
    };
    const down = (e: PointerEvent) => {
      swallow = false;
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.pointerType !== 'mouse' && (e.clientX < 20 || e.clientX > innerWidth - 20)) return;
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
      axis = null;
      dx = 0;
    };
    const moved = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      dx = e.clientX - start.x;
      if (!axis) {
        axis = axisOf(dx, e.clientY - start.y);
        if (axis === 'y') return reset();
        if (axis !== 'x') return;
        dragging = true;
        el.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      if (body) body.style.transform = move(dragOffset(dx, hasPrev, hasNext));
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (axis !== 'x') return reset();
      swallow = true;
      const res = swipeResult(dx, e.timeStamp - start.t, el.clientWidth);
      if (!res || (res === 'prev' ? !hasPrev : !hasNext)) return back();
      const x = dragOffset(dx, hasPrev, hasNext);
      reset();
      go(res, x);
    };
    const cancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) back();
    };
    // A drag ends with a click on whatever it started on; that click is not meant.
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const arrows = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? 'prev' : 'next');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', moved);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', click, true);
    el.addEventListener('keydown', arrows);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', moved);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('click', click, true);
      el.removeEventListener('keydown', arrows);
    };
  });
</script>

<div class="pager" class:dragging role="region" aria-label={label || undefined} bind:this={root}>
  <div class="pager-head">
    <div class="pager-title" aria-live="polite">{#if head}{@render head()}{/if}</div>
    {#if actions}{@render actions()}{/if}
    <button class="btn btn-icon btn-sm" type="button" onclick={() => go('prev')} disabled={!hasPrev} aria-label={prevLabel || t('Previous')}><Icon name="back" size={18} /></button>
    <button class="btn btn-icon btn-sm" type="button" onclick={() => go('next')} disabled={!hasNext} aria-label={nextLabel || t('Next')}><Icon name="forward" size={18} /></button>
  </div>
  <div class="pager-body" bind:this={body}>{@render children()}</div>
</div>

<style>
  .pager {
    touch-action: pan-y pinch-zoom;
  }
  .pager.dragging {
    user-select: none;
    -webkit-user-select: none;
    cursor: grabbing;
  }
  .pager-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
  }
  .pager-title {
    flex: 1;
    min-width: 0;
  }
  .pager-body {
    will-change: transform;
  }
</style>
