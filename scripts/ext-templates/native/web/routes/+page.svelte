<script lang="ts">
  import type { DataOf } from '$shell';
  import { Mascot } from '$shell/ui';
  import type { load } from './+page.server';

  let { data, form }: { data: DataOf<typeof load>; form: { error?: string } | null } = $props();
</script>

<svelte:head><title>{{name}} · Assistant</title></svelte:head>

<header class="head">
  <Mascot mood="steady" size={40} decorative />
  <h1>{{name}}</h1>
</header>

<form method="POST" action="?/add" class="card add">
  <input name="title" placeholder="New item" required maxlength="200" aria-label="New item" />
  <button class="btn">Add</button>
  {#if form?.error}<p class="muted">{form.error}</p>{/if}
</form>

<ul class="card list">
  {#each data.items as item (item.id)}
    <li class:done={item.done}>{item.title}</li>
  {:else}
    <li class="muted empty"><Mascot mood="idle" size={36} decorative /> Nothing yet.</li>
  {/each}
</ul>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .empty {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .add {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .add input {
    flex: 1;
  }
  .list {
    list-style: none;
    display: grid;
    gap: var(--space-2);
  }
  .done {
    color: var(--ink-3);
    text-decoration: line-through;
  }
</style>
