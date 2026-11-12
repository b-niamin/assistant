<script lang="ts">
  import Mascot from '#lib/Mascot.svelte';
  import { inputPattern, PROFILE_ID_RE } from '#lib/ids.js';
  import { tFor } from '#lib/i18n/index.ts';
  let { data, form } = $props();
  // No language is set yet: the browser's (the server picked it from Accept-Language).
  const t = $derived(tFor(data.lang));

  // The profile id follows the name ("Zoë Ann" -> "zoe-ann") until it is edited by hand.
  let name = $state('');
  let profile = $state('');
  let profileEdited = $state(false);
  let busy = $state(false);
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '');
  $effect(() => {
    if (!profileEdited) profile = slug(name);
  });
</script>

<svelte:head><title>{t('Set up')} · {t('Assistant')}</title></svelte:head>

<div class="intro">
  <Mascot mood="charged" size={72} decorative />
  <h1>{t("Welcome. Let's set up your assistant.")}</h1>
  <p>{t('Four short steps. Everything here can be changed later in the settings.')}</p>
</div>

{#if !data.tokenSet}
  <p class="card panel">
    {t('This server has no setup code. Run ./install.sh again (it writes SETUP_TOKEN into .env and prints it), then reload this page.')}
  </p>
{:else}
  <form method="POST" class="card panel" onsubmit={() => (busy = true)}>
    {#if form?.error}<p class="err" role="alert">{form.error}</p>{/if}
    <label>
      <span>{t('Setup code')}</span>
      <input name="code" autocomplete="off" spellcheck="false" required />
      <span class="meta">{t('The installer printed it at the end, next to the address.')}</span>
    </label>

    <fieldset>
      <legend>{t('App password')}</legend>
      <p class="meta">{t('One password for the whole app, at least 12 characters. Everyone at home uses it.')}</p>
      <div class="two">
        <label><span class="sr">{t('App password')}</span><input name="password" type="password" autocomplete="new-password" minlength="12" required placeholder={t('Password')} /></label>
        <label><span class="sr">{t('Repeat it')}</span><input name="repeat" type="password" autocomplete="new-password" minlength="12" required placeholder={t('Repeat it')} /></label>
      </div>
    </fieldset>

    <fieldset>
      <legend>{t('You')}</legend>
      <div class="two">
        <label><span class="meta">{t('Your name')}</span><input name="name" placeholder="Alex" maxlength="40" required bind:value={name} /></label>
        <label><span class="meta">{t('Profile id')}</span><input
            name="profile"
            placeholder="alex"
            pattern={inputPattern(PROFILE_ID_RE)}
            maxlength="32"
            required
            bind:value={profile}
            oninput={() => (profileEdited = profile !== '')}
          /></label
        >
      </div>
      <label>
        <span class="meta">{t('Language of the app and of every app you add')}</span>
        <select name="language">
          {#each data.languages as l (l.code)}<option value={l.code} lang={l.code} selected={l.code === data.lang}>{l.name}</option>{/each}
        </select>
      </label>
    </fieldset>

    <button class="btn btn-primary" disabled={busy}>{busy ? t('Setting up…') : t('Continue')}</button>
  </form>
{/if}

<style>
  .panel {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    margin: 0;
  }
  label {
    display: grid;
    gap: 4px;
  }
  label > span:first-child:not(.meta):not(.sr) {
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  fieldset {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-4) 0 0;
    border: 0;
    border-top: 1px solid var(--ring);
  }
  legend {
    float: left;
    padding: 0;
    font-weight: var(--weight-bold);
    font-size: var(--text-sm);
  }
  fieldset > p {
    margin: 0;
    clear: both;
  }
  .two {
    clear: both;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  input,
  select {
    width: 100%;
    box-sizing: border-box;
  }
  .btn {
    justify-self: stretch;
    height: 44px;
  }
  @media (max-width: 480px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
