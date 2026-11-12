<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import SetupUnlock from '#lib/setup/SetupUnlock.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
</script>

<svelte:head><title>{t('Updates and Claude')} · {t('Set up')}</title></svelte:head>

<div class="intro">
  <Mascot mood="steady" size={64} decorative />
  <h1>{t('Updates and Claude')}</h1>
  <p>{t('Two choices about what reaches the assistant from outside.')}</p>
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
    {#if !data.updater}<p class="meta">{t('The updater has not reported yet; it takes this choice on its first run.')}</p>{/if}
  </fieldset>

  <fieldset>
    <legend>{t('Claude connector')}</legend>
    <div class="choice">
      <label>
        <input type="radio" name="funnel" value="on" checked={data.funnel === 'on'} />
        <span class="txt"><strong>{t('On')}</strong><span class="meta">{t('Use your apps from claude.ai and the Claude apps on your phone. It opens one address to the internet (Tailscale Funnel); each new connection waits for your approval.')}</span></span>
      </label>
      <label>
        <input type="radio" name="funnel" value="off" checked={data.funnel !== 'on'} />
        <span class="txt"><strong>{t('Off for now')}</strong><span class="meta">{t('Nothing is reachable from outside your tailnet. Turn it on later in System settings.')}</span></span>
      </label>
    </div>
  </fieldset>

  <div class="nav">
    <a class="skip" href="/setup/apps">‹ {t('Back')}</a>
    <button class="btn btn-primary" disabled={!data.unlocked}>{t('Continue')}</button>
  </div>
</form>

<style>
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
  fieldset p {
    margin: 0;
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
