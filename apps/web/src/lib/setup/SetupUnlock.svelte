<script lang="ts">
  /**
   * The wizard's steps after the first run unlocked (installs in the terminal, updater and connector
   * choices). The unlock lasts 10 minutes; once it ran out, this asks for the app password again right on
   * the step instead of failing with "Unlock first", and reloads the step's data.
   */
  import { invalidateAll } from '$app/navigation';
  import { unlockSession } from '#lib/dock/dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = await unlockSession(password, t('Could not unlock.'));
    if (!error) {
      password = '';
      await invalidateAll();
    }
    busy = false;
  }
</script>

<form class="card unlock" onsubmit={submit}>
  <label for="setup-pw">{t('The 10-minute unlock ran out. Enter the app password to go on.')}</label>
  <div class="row">
    <input id="setup-pw" type="password" bind:value={password} autocomplete="current-password" placeholder={t('App password')} required />
    <button class="btn btn-primary" disabled={busy}>{t('Unlock')}</button>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</form>

<style>
  .unlock {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .err {
    margin: 0;
  }
</style>
