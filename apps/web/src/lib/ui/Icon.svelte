<script lang="ts">
  /** One icon of the shell's set (icons.js). Decorative unless it gets a label. */
  import { ICONS } from './icons.js';
  let { name, size = 22, label = '' }: { name: string; size?: number; label?: string } = $props();
  const markup = $derived((ICONS as Record<string, string>)[name] ?? ICONS.apps);
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}>{@html markup}</svg>

<style>
  .icon {
    flex: none;
  }
</style>
