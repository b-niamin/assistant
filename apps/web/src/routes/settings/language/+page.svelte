<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { askAgent } from '#lib/dock/dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

  let ticked = $state<string[] | null>(null);
  const enabledNow = $derived(ticked ?? data.enabled);
  const languageNames = $derived(new Map(data.all.map((l) => [l.code, l.name])));
  /** The request for the AI when apps lack a language: it translates them as the add-extension skill says. */
  const translateAsk = (missing: { id: string; langs: string[] }[]) =>
    `Translate these extensions into the app's languages (spec 007, add-extension skill): ` +
    missing.map((m) => `${m.id} (${m.langs.join(', ')})`).join('; ') +
    `. Check each with node scripts/ext.mjs check <id> until it prints no i18n: warnings.`;
</script>

<svelte:head><title>{t('Language')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Language')} lede={t('Languages of the app. An app without one is translated by the AI when it is installed.')} />

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

{#if data.missing.length}
  <div class="card missing">
    <Mascot mood="tired" size={40} decorative />
    <div class="what">
      <strong>{t.n(data.missing.length, 'One app is not translated yet', '{n} apps are not translated yet')}</strong>
      <span class="meta">{data.missing.map((m) => `${m.name}: ${m.langs.map((c) => languageNames.get(c) ?? c).join(', ')}`).join(' · ')}</span>
    </div>
    <button type="button" class="btn btn-primary" onclick={() => askAgent(translateAsk(data.missing))}>{t('Ask the AI to translate')}</button>
  </div>
{/if}

<form method="POST" use:enhance={() => async ({ update }) => { await update(); ticked = null; }}>
  <ul class="card langs">
    {#each data.all as l (l.code)}
      {@const on = enabledNow.includes(l.code)}
      <li class:on>
        <label class="offer">
          <input
            type="checkbox"
            name="enabled"
            value={l.code}
            checked={on}
            disabled={l.code === 'en'}
            onchange={(e) => (ticked = e.currentTarget.checked ? [...enabledNow, l.code] : enabledNow.filter((c) => c !== l.code))}
          />
          <span lang={l.code}>{l.name}</span>
          {#if l.code === 'en'}<span class="meta">{t('base of every app')}</span>{/if}
        </label>
        {#if l.code === 'en'}<input type="hidden" name="enabled" value="en" />{/if}
        <label class="def" class:hidden={!on}>
          <input type="radio" name="default" value={l.code} checked={data.default === l.code} disabled={!on} />
          <span>{t('Default')}</span>
        </label>
      </li>
    {/each}
  </ul>
  <div class="foot">
    <p class="meta">{t('English always stays on. Each browser picks its own in the profile menu.')}</p>
    <button class="btn btn-primary">{t('Save')}</button>
  </div>
</form>

<style>
  .missing {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-left: 4px solid var(--warning);
  }
  .missing .btn {
    flex: none;
  }
  .langs {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4);
  }
  .langs li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    min-height: 44px;
  }
  .langs li + li {
    border-top: 1px solid var(--ring);
  }
  .offer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    cursor: pointer;
  }
  .langs li:not(.on) .offer span:first-of-type {
    color: var(--ink-2);
  }
  .on .offer span:first-of-type {
    font-weight: var(--weight-medium);
  }
  .def {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--ink-2);
    cursor: pointer;
  }
  .def.hidden {
    visibility: hidden;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
  .foot p {
    flex: 1;
    margin: 0;
  }
  @media (max-width: 560px) {
    .missing {
      flex-wrap: wrap;
    }
  }
</style>
