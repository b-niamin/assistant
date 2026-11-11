<script lang="ts">
  import { enhance } from '$app/forms';
  import Mascot from '#lib/Mascot.svelte';
  import { hueFor, initials, uniqueProfileId } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

  let name = $state('');
  let customId = $state('');
  let editing = $state<string | null>(null);
  const suggested = $derived(uniqueProfileId(name, data.profiles.map((p) => p.id)));
  const preview = $derived(name.trim() || t('New profile'));
</script>

<svelte:head><title>{t('Profiles')} · {t('System settings')}</title></svelte:head>

<div class="head">
  <p class="eyebrow"><a href="/settings">{t('System settings')}</a></p>
  <h1>{t('Profiles')}</h1>
  <p class="lede">
    {t('Everyone at home gets their own profile: their own data, apps and dashboard. Profiles are not accounts; anyone with the app password can switch between them from the menu at the top.')}
  </p>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section aria-labelledby="who">
  <h2 id="who">{t('Who uses the assistant')}</h2>
  <ul class="people">
    {#each data.profiles as p (p.id)}
      <li class="card person" class:fresh={form?.added === p.id}>
        <span class="avatar" style="--hue: {hueFor(p.id)}" aria-hidden="true">{initials(p.name)}</span>
        <div class="who">
          {#if editing === p.id}
            <form method="POST" action="?/rename" class="rename" use:enhance={() => async ({ update }) => { await update(); editing = null; }}>
              <input type="hidden" name="id" value={p.id} />
              <label class="sr" for="rn-{p.id}">{t('New name for {name}', { name: p.name })}</label>
              <!-- svelte-ignore a11y_autofocus -->
              <input id="rn-{p.id}" name="name" value={p.name} maxlength="40" required autofocus />
              <button class="btn btn-primary">{t('Save')}</button>
              <button class="btn-ghost" type="button" onclick={() => (editing = null)}>{t('Cancel')}</button>
            </form>
          {:else}
            <p class="name">
              <strong>{p.name}</strong>
              {#if p.id === data.current}<span class="pill">{t('You are here')}</span>{/if}
            </p>
            <p class="meta"><code>{p.id}</code> · {p.apps.length ? p.apps.map((a) => a.name).join(', ') : t('no apps yet')}</p>
          {/if}
        </div>
        {#if editing !== p.id}
          <div class="acts">
            <button class="btn-ghost" type="button" onclick={() => (editing = p.id)}>{t('Rename')}</button>
            {#if p.id !== data.current}
              <form method="POST" action="/profile">
                <input type="hidden" name="profile" value={p.id} />
                <button class="btn">{t('Switch to')}</button>
              </form>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<section id="add" aria-labelledby="add-h">
  <h2 id="add-h">{t('Add a profile')}</h2>
  <form
    method="POST"
    action="?/add"
    class="card add"
    use:enhance={() =>
      async ({ result, update }) => {
        await update({ reset: result.type === 'success' });
        if (result.type === 'success') {
          name = '';
          customId = '';
        }
      }}
  >
    <div class="steps">
      <div class="step">
        <span class="n" aria-hidden="true">1</span>
        <div class="body">
          <label class="field">
            <span>{t('Name')}</span>
            <input name="name" bind:value={name} maxlength="40" placeholder={t('e.g. Anna')} required autocomplete="off" />
          </label>
          <details class="adv">
            <summary>{t('Short id:')} <code>{customId || (name.trim() ? suggested : '…')}</code></summary>
            <label class="field">
              <span>{t('Used in links and by Claude. Letters, digits and dashes; cannot change later.')}</span>
              <input name="id" bind:value={customId} pattern="[a-z][a-z0-9\-]*" maxlength="32" placeholder={suggested} autocomplete="off" />
            </label>
          </details>
        </div>
      </div>

      <div class="step">
        <span class="n" aria-hidden="true">2</span>
        <div class="body">
          <p class="label">{name.trim() ? t('Which apps {name} will see', { name: name.trim() }) : t('Which apps they will see')}</p>
          {#if data.extensions.length}
            <div class="apps">
              {#each data.extensions as e (e.id)}
                <label class="app">
                  <input type="checkbox" name="apps" value={e.id} checked={e.everyone} />
                  <span>
                    <strong>{e.name}</strong>
                    <span class="meta">{e.scope === 'shared' ? t('shared data') : t('their own data')}</span>
                  </span>
                </label>
              {/each}
            </div>
            <p class="meta">{t("You can change this later in each app's panel.")}</p>
          {:else}
            <p class="meta">{t('No apps yet.')} <a href="/settings/extensions/new">{t('Add the first one')}</a>.</p>
          {/if}
        </div>
      </div>
    </div>

    <div class="foot">
      <span class="preview">
        <span class="avatar sm" style="--hue: {hueFor(customId || suggested)}" aria-hidden="true">{initials(preview)}</span>
        <span>{preview}</span>
      </span>
      <button class="btn btn-primary">{t('Add profile')}</button>
    </div>
  </form>
</section>

<aside class="card tip">
  <Mascot mood="steady" size={56} decorative />
  <p>
    {t('Apps with their own data per profile start empty for a new profile; shared apps show the same data to everyone. Claude answers for the profile you name ("for Anna, ..."), or for the first profile by default.')}
  </p>
</aside>

<style>
  .head {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .lede {
    color: var(--ink-2);
    max-width: 68ch;
  }
  section {
    margin-bottom: var(--space-6);
  }
  .people {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .person {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .person.fresh {
    border-color: var(--accent);
    animation: pop 600ms ease-out;
  }
  @keyframes pop {
    from {
      transform: scale(0.98);
      box-shadow: 0 0 0 6px var(--accent-wash);
    }
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--hue) 18%, transparent);
    color: var(--hue);
    font-weight: 700;
  }
  .avatar.sm {
    width: 28px;
    height: 28px;
    font-size: 0.75rem;
  }
  .who {
    flex: 1 1 200px;
    min-width: 0;
  }
  .who p {
    margin: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pill {
    font-size: 0.75rem;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .acts form {
    margin: 0;
  }
  .rename {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .rename input[name='name'] {
    flex: 1 1 160px;
    min-width: 0;
  }
  .add {
    display: grid;
    gap: var(--space-4);
  }
  .steps {
    display: grid;
    gap: var(--space-4);
  }
  .step {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: var(--space-3);
  }
  .n {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--ink-2);
    font-weight: 650;
    font-size: 0.875rem;
  }
  .body {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .label {
    margin: 4px 0 0;
    font-weight: 600;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .field input {
    max-width: 360px;
    min-width: 0;
  }
  .adv summary {
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .adv .field {
    margin-top: var(--space-2);
  }
  .apps {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-2);
  }
  .app {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--ring);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .app:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-wash);
  }
  .app input {
    margin-top: 3px;
  }
  .app > span {
    display: grid;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    border-top: 1px solid var(--ring);
    padding-top: var(--space-4);
  }
  .preview {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--ink-2);
  }
  .tip {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .tip p {
    margin: 0;
    color: var(--ink-2);
  }
  .note {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .note.bad {
    border-left: 3px solid var(--critical);
  }
  .note.good {
    border-left: 3px solid var(--accent);
  }
</style>
