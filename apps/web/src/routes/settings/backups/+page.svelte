<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
  const date = (iso: string) => new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
</script>

<svelte:head><title>{t('Backups')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Backups')} lede={t('Your data, its keys and the apps, to bring the assistant back on a new machine.')}>
  {#snippet actions()}
    <form method="POST" action="?/backup" use:enhance><button class="btn btn-primary">{t('Back up now')}</button></form>
  {/snippet}
</PageHead>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="sec">
  {#if data.backup}
    {@const b = data.backup}
    {@const tone = b.status === 'running' ? 'warning' : b.status === 'failed' || b.stale ? 'critical' : 'good'}
    <div class="card state {tone}">
      <Mascot mood={tone === 'good' ? 'steady' : tone === 'warning' ? 'charged' : 'tired'} size={56} decorative />
      <div class="what">
        <strong class="big">
          {b.status === 'running' ? t('Backing up') : b.status === 'failed' ? t('Last backup failed') : b.stale ? t('Out of date') : t('Up to date')}
        </strong>
        <span class="meta">{b.lastOk ? t('Last good backup {when}', { when: date(b.lastOk) }) : t('No good backup yet.')}</span>
        {#if b.status === 'failed'}<span class="meta bad">{b.message}</span>{/if}
      </div>
    </div>
    <div class="tiles">
      <div class="card tile"><span class="meta">{t('Kept')}</span><strong>{b.count}</strong></div>
      <div class="card tile"><span class="meta">{t('Every day at')}</span><strong>{b.hour}:00</strong></div>
      <div class="card tile"><span class="meta">{t('Latest')}</span><strong class="name">{b.lastName || '–'}</strong></div>
    </div>
  {:else}
    <div class="card state">
      <Mascot mood="idle" size={56} decorative />
      <div class="what">
        <strong class="big">{t('No backup status yet')}</strong>
        <span class="meta">{t('The backup service writes it after its first run.')}</span>
      </div>
    </div>
  {/if}
</section>

<section class="sec" aria-labelledby="off-h">
  <h2 id="off-h">{t('Keep a copy elsewhere')}</h2>
  <div class="card panel">
    <p>{t('Copy the backup folder off this machine too (Hyper Backup, Time Machine).')}</p>
    <details class="tech">
      <summary>{t('Technical details')}</summary>
      <p class="meta">{t('Data, .env and apps, in BACKUP_DIR. Copy that folder off this machine too. Restore: sudo ./beni.sh restore <folder>.')}</p>
    </details>
  </div>
</section>

<style>
  .state {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-left: 4px solid var(--ink-4);
  }
  .state.good {
    border-left-color: var(--good);
  }
  .state.warning {
    border-left-color: var(--warning);
  }
  .state.critical {
    border-left-color: var(--critical);
  }
  .big {
    font-size: var(--text-lg);
  }
  .bad {
    color: var(--critical-ink);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .tile {
    display: grid;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
  }
  .tile strong {
    font-size: var(--text-lg);
  }
  .tile .name {
    font: var(--text-sm) / 1.4 var(--mono);
    overflow-wrap: anywhere;
  }
  @media (max-width: 560px) {
    .tiles {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
