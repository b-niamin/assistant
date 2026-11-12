<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { hueFor, initials } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();
  const whoSees = (ids: string[] | null) =>
    ids === null ? t('everyone') : ids.map((id) => data.profiles.find((p) => p.id === id)?.name ?? id).join(', ') || t('nobody');
</script>

<svelte:head><title>{t('Apps')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Apps')} lede={t('What the assistant can do. Each app has its own panel: who sees it, its settings and its data.')}>
  {#snippet actions()}
    <a class="btn btn-primary" href="/settings/extensions/new">{t('Extend the system')}</a>
  {/snippet}
</PageHead>

{#if data.untranslated}
  <p class="note warn">
    {t.n(data.untranslated, 'One app is not translated yet', '{n} apps are not translated yet')}.
    <a href="/settings/language">{t('Language')}</a>
  </p>
{/if}

<ul class="card rows">
  {#each data.extensions as ext (ext.id)}
    <li>
      <a href="/settings/extensions/{ext.id}">
        <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
        <span class="what">
          <strong>{ext.name}</strong>
          <span class="meta desc">{ext.description || (ext.kind === 'native' ? t('Native app') : t('One-file app'))}</span>
        </span>
        <span class="state">
          <span class="status small" class:good={ext.enabled}>{ext.enabled ? t('On') : t('Off')}</span>
          {#if ext.enabled}<span class="meta">{whoSees(ext.profiles)}</span>{/if}
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    </li>
  {:else}
    <li class="none">
      <Mascot mood="idle" size={48} decorative />
      <span class="muted">{t('No apps yet. Install a ready-made one or let Claude build one for you.')}</span>
    </li>
  {/each}
</ul>

<a class="card more" href="/settings/extensions/new">
  <Mascot mood="charged" size={44} accessory="party-hat" decorative />
  <span class="what">
    <strong>{t('Extend the system')}</strong>
    <span class="meta">{t('Ready-made apps or your own idea')}</span>
  </span>
  <span class="chev" aria-hidden="true">›</span>
</a>

<style>
  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    display: grid;
    justify-items: end;
    gap: 2px;
    flex: none;
    max-width: 30%;
    text-align: right;
  }
  .none {
    gap: var(--space-3);
  }
  .more {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-style: dashed;
    color: inherit;
    text-decoration: none;
  }
  .more:hover strong {
    color: var(--accent-ink);
  }
  @media (max-width: 560px) {
    .state .meta {
      display: none;
    }
  }
</style>
