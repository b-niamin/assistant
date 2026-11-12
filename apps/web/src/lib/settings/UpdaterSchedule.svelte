<script lang="ts">
  /**
   * How to make the host's updater run every minute (spec 006), step by step, with the exact command from
   * its status (home, schedule). Synology: a Task Scheduler entry by hand. Elsewhere install.sh adds a cron
   * line; this shows it for when that did not happen.
   */
  import { useT } from '#lib/i18n/index.ts';
  let { home = '', schedule = '' }: { home?: string; schedule?: 'synology' | 'cron' | '' } = $props();
  const t = useT();

  const cmd = $derived(`sh ${home || '<folder>-updater'}/update.sh`);
  const cronLine = $derived(`* * * * * ${cmd} >/dev/null 2>&1`);
  let tab = $state<'synology' | 'cron'>('synology');
  $effect(() => {
    if (schedule) tab = schedule;
  });
  let copied = $state('');
  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => null);
    copied = text;
    setTimeout(() => (copied = ''), 1500);
  }
</script>

<div class="sched">
  {#if !schedule}
    <div class="seg" role="tablist" aria-label={t('Where it runs')}>
      <button type="button" role="tab" aria-selected={tab === 'synology'} class:on={tab === 'synology'} onclick={() => (tab = 'synology')}>Synology</button>
      <button type="button" role="tab" aria-selected={tab === 'cron'} class:on={tab === 'cron'} onclick={() => (tab = 'cron')}>{t('Linux, Mac')}</button>
    </div>
  {/if}
  {#if tab === 'synology'}
    <ol>
      <li>{t('In DSM: Control Panel, Task Scheduler, Create, Scheduled Task, User-defined script.')}</li>
      <li>{t('General: any name, User: root.')}</li>
      <li>{t('Schedule: Daily, Frequency every 1 minute, first run time 00:00, last run time 23:59 (DSM suggests 00:59: then it runs only in the first hour).')}</li>
      <li>
        {t('Task Settings, Run command:')}
        <span class="cmd"><code>{cmd}</code><button type="button" class="btn" onclick={() => copy(cmd)}>{copied === cmd ? t('Copied') : t('Copy')}</button></span>
      </li>
      <li>{t('OK. Within a minute this page shows the updater running.')}</li>
    </ol>
  {:else}
    <ol>
      <li>{t('On the server:')} <code>sudo crontab -e</code></li>
      <li>
        {t('Add this line and save:')}
        <span class="cmd"><code>{cronLine}</code><button type="button" class="btn" onclick={() => copy(cronLine)}>{copied === cronLine ? t('Copied') : t('Copy')}</button></span>
      </li>
      <li>{t('Within a minute this page shows the updater running.')}</li>
    </ol>
  {/if}
</div>

<style>
  .sched {
    display: grid;
    gap: var(--space-3);
  }
  ol {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: var(--space-2);
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 4px;
  }
  .cmd .btn {
    flex: none;
    height: 28px;
    padding: 0 10px;
  }
  .cmd code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .seg {
    justify-self: start;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .seg button {
    padding: 4px var(--space-3);
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    font-weight: var(--weight-bold);
  }
</style>
