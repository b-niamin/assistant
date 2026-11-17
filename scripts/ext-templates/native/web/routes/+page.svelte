<script lang="ts">
  import type { DataOf } from '$shell';
  import { EmptyState, PageHead, useT } from '$shell/ui';
  import type { load } from './+page.server';

  let { data, form }: { data: DataOf<typeof load>; form: { error?: string } | null } = $props();
  // Every text through t(): its translations are in i18n/<lang>.json (spec 007).
  const t = useT();
</script>

<svelte:head><title>{t('{{name}}')} · {t('Assistant')}</title></svelte:head>

<!-- Every page starts with PageHead (Pingo UI, specs/001-design.md): Pingo, the title, the app's pages. -->
<PageHead title={t('{{name}}')} />

<form method="POST" action="?/add" class="card add">
  <input name="title" placeholder={t('New item')} required maxlength="200" aria-label={t('New item')} />
  <button class="btn-primary">{t('Add')}</button>
  {#if form?.error}<p class="muted">{form.error}</p>{/if}
</form>

{#if data.items.length}
  <div class="list-group">
    {#each data.items as item (item.id)}
      <div class="list-row" class:done={item.done}><span class="list-text"><span class="list-title">{item.title}</span></span></div>
    {/each}
  </div>
{:else}
  <div class="card"><EmptyState title={t('Nothing yet.')} size={56} /></div>
{/if}

<style>
  .add {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .add input {
    flex: 1;
    min-width: 0;
  }
  .done .list-title {
    color: var(--ink-3);
    text-decoration: line-through;
  }
</style>
