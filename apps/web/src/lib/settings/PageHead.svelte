<script lang="ts">
  /** The head of a settings page: title, one line on what the page is for, room for an action on the right. */
  import type { Snippet } from 'svelte';
  let { title, lede = '', actions }: { title: string; lede?: string; actions?: Snippet } = $props();
</script>

<div class="head">
  <div class="text">
    <h1>{title}</h1>
    {#if lede}<p class="lede">{lede}</p>{/if}
  </div>
  {#if actions}<div class="acts">{@render actions()}</div>{/if}
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
  }
  .lede {
    margin: var(--space-1) 0 0;
    color: var(--ink-2);
    max-width: 68ch;
  }
  .acts {
    flex: none;
    display: flex;
    gap: var(--space-2);
  }
</style>
