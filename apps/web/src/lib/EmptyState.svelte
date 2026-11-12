<script lang="ts">
  import type { Snippet } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import type { Mood } from '#lib/mascot.ts';

  /**
   * "Nothing here yet" (`$shell/ui`, specs/001): Beni beside a heading and what to do about it. The
   * children are the body (a sentence, a button). `level` keeps the page's heading order.
   */
  let {
    title,
    level = 2,
    mood = 'idle',
    mascotLabel,
    size = 88,
    children
  }: { title: string; level?: 1 | 2 | 3; mood?: Mood; mascotLabel?: string; size?: number; children?: Snippet } = $props();
</script>

<div class="empty">
  <Mascot {mood} {size} label={mascotLabel} decorative={!mascotLabel} />
  <div class="body">
    <svelte:element this={`h${level}`} class="title">{title}</svelte:element>
    {@render children?.()}
  </div>
</div>

<style>
  .empty {
    display: flex;
    gap: var(--space-5);
    align-items: center;
  }
  .body {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    max-width: 60ch;
  }
  .title {
    margin: 0;
    font-size: var(--text-xl);
  }
  .body :global(p) {
    margin: 0;
  }
  @media (max-width: 560px) {
    .empty {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
