<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import SetupUnlock from '#lib/setup/SetupUnlock.svelte';
  import UpdaterSchedule from '#lib/settings/UpdaterSchedule.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
</script>

<svelte:head><title>{t('Updates and Claude')} · {t('Set up')}</title></svelte:head>

<div class="intro">
  <Mascot mood="steady" size={64} decorative />
  <h1>{t('Updates and Claude')}</h1>
</div>

{#if !data.unlocked}<SetupUnlock />{/if}

<form method="POST" class="grid">
  {#if form?.error && data.unlocked}<p class="err" role="alert">{form.error}</p>{/if}
  <fieldset>
    <legend>{t('New versions')}</legend>
    <div class="choice">
      <label>
        <input type="radio" name="mode" value="auto" checked={data.mode !== 'manual'} />
        <span class="txt"><strong>{t('Automatic')} <span class="rec">{t('recommended')}</span></strong><span class="meta">{t('Deployed within minutes of reaching GitHub main.')}</span></span>
      </label>
      <label>
        <input type="radio" name="mode" value="manual" checked={data.mode === 'manual'} />
        <span class="txt"><strong>{t('Manual')}</strong><span class="meta">{t('Show new versions, update when I click.')}</span></span>
      </label>
    </div>
    {#if !data.ticking}
      <div class="card sched">
        <strong>{t('The updater does not run yet')}</strong>
        <span class="meta">{t('Both choices need it to run every minute. Once, on the server:')}</span>
        <UpdaterSchedule home={data.home} schedule={data.schedule} />
      </div>
    {/if}
  </fieldset>

  <fieldset>
    <legend>{t('MCP on the internet')}</legend>
    <div class="choice">
      <label>
        <input type="radio" name="funnel" value="on" checked={data.funnel === 'on'} />
        <span class="txt"><strong>{t('On')}</strong><span class="meta">{t('Claude (claude.ai, phone) can use your apps over MCP. One address goes on the internet (Tailscale Funnel); each person connects and approves their own.')}</span></span>
      </label>
      <label>
        <input type="radio" name="funnel" value="off" checked={data.funnel !== 'on'} />
        <span class="txt"><strong>{t('Off for now')}</strong><span class="meta">{t('Nothing is reachable from outside your tailnet.')}</span></span>
      </label>
    </div>
  </fieldset>

  <div class="nav">
    <a class="skip" href="/setup/apps">‹ {t('Back')}</a>
    <button class="btn btn-primary" disabled={!data.unlocked}>{t('Continue')}</button>
  </div>
</form>

<style>
  .sched {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-color: var(--warning);
  }
  .grid {
    display: grid;
    gap: var(--space-5);
  }
  fieldset {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-weight: var(--weight-bold);
  }
  .rec {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--ink-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
</style>
