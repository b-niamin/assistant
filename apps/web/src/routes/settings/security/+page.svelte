<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { lockSession } from '#lib/dock/dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
</script>

<svelte:head><title>{t('Security')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Security')} lede={t('One app password opens the whole assistant. Settings and the chat ask for it again and lock after an hour without use.')} />

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="sec" aria-labelledby="pw-h">
  <h2 id="pw-h">{t('App password')}</h2>
  <div class="card panel">
    {#if data.passwordFromEnv}
      <p class="muted">{t('Set in .env (APP_PASSWORD_HASH). Remove that line and restart web to manage it here.')}</p>
    {:else}
      <form method="POST" action="?/password" class="pw" use:enhance>
        <label><span class="meta">{t('New password (12+)')}</span><input name="password" type="password" autocomplete="new-password" minlength="12" required /></label>
        <label><span class="meta">{t('Repeat')}</span><input name="repeat" type="password" autocomplete="new-password" minlength="12" required /></label>
        <button class="btn btn-primary">{t('Change')}</button>
      </form>
      <p class="meta">{t('Every other device is logged out.')}</p>
    {/if}
  </div>
</section>

<section class="sec" aria-labelledby="lock-h">
  <h2 id="lock-h">{t('Lock now')}</h2>
  <div class="card panel row">
    <p class="meta">{t('Settings and the terminal close on this device until the password is typed again.')}</p>
    <form method="POST" action="/settings?/lock" use:enhance={() => async ({ update }) => (await update(), await lockSession())}>
      <button class="btn">{t('Lock')}</button>
    </form>
  </div>
</section>

<style>
  .pw {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    align-items: end;
    gap: var(--space-3);
  }
  .pw label {
    display: grid;
    gap: 4px;
  }
  .pw input {
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
  }
  .row p {
    flex: 1;
  }
  .row form {
    margin: 0;
  }
  @media (max-width: 560px) {
    .pw {
      grid-template-columns: 1fr;
    }
  }
</style>
