<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import Mascot from '#lib/Mascot.svelte';
  import { hueFor, initials } from '#lib/settings/guide.ts';
  import { motionReduced, setLanguage, setMotionReduced, setTheme } from '#lib/user-menu/prefs.ts';
  import type { Theme } from '#lib/theme.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
  let renaming = $state(false);
  // The server's value until another one is picked here.
  let picked = $state<Theme | null>(null);
  const theme = $derived(picked ?? data.theme);
  let calm = $state(motionReduced());
  const THEMES = $derived([
    { id: 'light' as const, label: t('Light') },
    { id: 'dark' as const, label: t('Dark') },
    { id: 'system' as const, label: t('System') }
  ]);
</script>

<svelte:head><title>{t('Profile settings')} · {data.profile.name}</title></svelte:head>

<div class="card me">
  <span class="avatar" style="--hue: {hueFor(data.profile.id)}" aria-hidden="true">{initials(data.profile.name)}</span>
  <div class="who">
    {#if renaming}
      <form method="POST" action="?/rename" class="rename" use:enhance={() => async ({ update }) => { await update(); renaming = false; }}>
        <label class="sr" for="me-name">{t('Name')}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="me-name" name="name" value={data.profile.name} maxlength="40" required autofocus />
        <button class="btn btn-primary">{t('Save')}</button>
        <button class="btn-ghost" type="button" onclick={() => (renaming = false)}>{t('Cancel')}</button>
      </form>
    {:else}
      <h1>{data.profile.name}</h1>
      <p class="meta">{t('Profile')} · <code>{data.profile.id}</code>{data.profiles.length > 1 ? ` · ${t.n(data.profiles.length, 'one profile at home', '{n} profiles at home')}` : ''}</p>
    {/if}
  </div>
  {#if !renaming}
    <div class="acts">
      <button class="btn" type="button" onclick={() => (renaming = true)}>{t('Rename')}</button>
      <a class="btn-ghost" href="/settings/profiles">{t('All profiles')}</a>
    </div>
  {/if}
  <span class="beni"><Mascot mood="steady" size={56} decorative /></span>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

<section class="sec" aria-labelledby="look-h">
  <h2 id="look-h">{t('Appearance')}</h2>
  <div class="card prefs">
    <div class="pref">
      <span class="what"><strong id="theme-l">{t('Theme')}</strong></span>
      <div class="seg" role="radiogroup" aria-labelledby="theme-l">
        {#each THEMES as th (th.id)}
          <button type="button" role="radio" aria-checked={theme === th.id} class:on={theme === th.id} onclick={() => { picked = th.id; setTheme(th.id); }}>{th.label}</button>
        {/each}
      </div>
    </div>
    {#if data.languages.length > 1}
      <div class="pref">
        <span class="what"><strong id="lang-l">{t('Language')}</strong></span>
        <div class="seg" role="radiogroup" aria-labelledby="lang-l">
          {#each data.languages as l (l.code)}
            <button type="button" role="radio" lang={l.code} aria-checked={data.lang === l.code} class:on={data.lang === l.code} onclick={() => l.code !== data.lang && setLanguage(l.code)}>{l.name}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="pref">
      <span class="what"><strong id="motion-l">{t('Reduce motion')}</strong></span>
      <button type="button" class="switch" role="switch" aria-checked={calm} aria-labelledby="motion-l" onclick={() => { calm = !calm; setMotionReduced(calm); }}><span></span></button>
    </div>
  </div>
</section>

<style>
  .me {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
    padding: var(--space-4) var(--space-5);
    overflow: hidden;
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--hue) 18%, transparent);
    color: var(--hue);
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .who h1 {
    margin: 0;
    font-size: var(--text-xl);
  }
  .who p {
    margin: 2px 0 0;
  }
  .me .acts {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-right: 64px;
  }
  .beni {
    position: absolute;
    right: var(--space-4);
    bottom: -10px;
  }
  .rename {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .rename input {
    flex: 1;
    min-width: 160px;
  }
  .prefs {
    padding: 0 var(--space-4);
  }
  .pref {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) 0;
  }
  .pref + .pref {
    border-top: 1px solid var(--ring);
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .seg button {
    padding: 5px var(--space-3);
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
    box-shadow: 0 1px 2px rgb(0 0 0 / 15%);
  }
  .switch {
    position: relative;
    flex: none;
    width: 40px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--axis);
    cursor: pointer;
  }
  .switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
    transition: transform 150ms;
  }
  .switch[aria-checked='true'] {
    background: var(--accent-fill);
  }
  .switch[aria-checked='true'] span {
    transform: translateX(16px);
  }
  @media (max-width: 560px) {
    .me {
      flex-wrap: wrap;
    }
    .me .acts {
      margin-right: 0;
    }
    .beni {
      display: none;
    }
    .pref {
      flex-wrap: wrap;
    }
  }
</style>
