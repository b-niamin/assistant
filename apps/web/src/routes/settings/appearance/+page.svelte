<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { enhance } from '#lib/forms.ts';
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/ui/PageHead.svelte';
  import { ACCENTS, MASCOT_KINDS, type Accent, type MascotKind } from '#lib/appearance.ts';
  import { useT } from '#lib/i18n/index.ts';
  let { data, form } = $props();
  const t = useT();

  // svelte-ignore state_referenced_locally
  let name = $state(data.current.name);
  // svelte-ignore state_referenced_locally
  let kind = $state<MascotKind>(data.current.kind);
  // svelte-ignore state_referenced_locally
  let accent = $state<Accent>(data.current.accent);
  const KIND_LABEL: Record<MascotKind, string> = { penguin: 'Penguin', bean: 'Jelly bean' };
  const ACCENT_LABEL: Record<Accent, string> = { lagoon: 'Lagoon', iris: 'Iris', plum: 'Plum', forest: 'Forest' };
  // Try the accent on the page right away; saving makes it everyone's.
  $effect(() => {
    if (accent === 'lagoon') delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
  });
</script>

<svelte:head><title>{t('Appearance')} · {t('System settings')}</title></svelte:head>

<PageHead mascot={false} title={t('Appearance')} sub={t('The mascot and the colours of the assistant, the same for everyone at home.')} />

<form method="POST" class="form" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }}>
  <section class="card">
    <h2>{t('Mascot')}</h2>
    <div class="kinds" role="radiogroup" aria-label={t('Mascot')}>
      {#each MASCOT_KINDS as k (k)}
        <label class="kind" class:on={kind === k}>
          <input type="radio" name="kind" value={k} bind:group={kind} />
          <Mascot kind={k} mood="charged" size={88} decorative accessory="none" />
          <span>{t(KIND_LABEL[k])}</span>
        </label>
      {/each}
    </div>
    <label class="name">
      {t('Its name')}
      <input name="name" maxlength="24" required bind:value={name} autocomplete="off" />
      <span class="muted">{t('Shown wherever it talks: "{name} says ...".', { name: name || 'Pingo' })}</span>
    </label>
  </section>

  <section class="card">
    <h2>{t('Colour')}</h2>
    <div class="accents" role="radiogroup" aria-label={t('Colour')}>
      {#each ACCENTS as a (a)}
        <label class="accent" class:on={accent === a} data-a={a}>
          <input type="radio" name="accent" value={a} bind:group={accent} />
          <i aria-hidden="true"></i>
          <span>{t(ACCENT_LABEL[a])}</span>
        </label>
      {/each}
    </div>
    <div class="sample">
      <button type="button" class="btn-primary">{t('Primary')}</button>
      <button type="button" class="btn-tinted">{t('Tinted')}</button>
      <a href="#top" class="btn-plain" onclick={(e) => e.preventDefault()}>{t('Link')}</a>
    </div>
  </section>

  {#if form?.error}<p class="status critical" role="alert">{form.error}</p>{/if}
  {#if form?.ok}<p class="status good" role="status">{form.ok}</p>{/if}
  <button class="btn-primary btn-lg save">{t('Save')}</button>
</form>

<style>
  .form {
    display: grid;
    gap: var(--space-4);
    max-width: 640px;
  }
  h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-3);
  }
  .kinds,
  .accents {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: var(--space-3);
  }
  .kind,
  .accent {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--fill-2);
    font-weight: var(--weight-bold);
    cursor: pointer;
  }
  .kind.on,
  .accent.on {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .kind input,
  .accent input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .kind:has(input:focus-visible),
  .accent:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .accent i {
    width: 40px;
    height: 40px;
    border-radius: 50%;
  }
  /* Each swatch shows its theme's own fill, whatever the page's accent is now. */
  .accent[data-a='lagoon'] i {
    background: #0f8a83;
  }
  .accent[data-a='iris'] i {
    background: #5b4bdb;
  }
  .accent[data-a='plum'] i {
    background: #b8327a;
  }
  .accent[data-a='forest'] i {
    background: #2f7d4f;
  }
  .name {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-4);
  }
  .name .muted {
    font-size: var(--text-sm);
  }
  .sample {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .save {
    justify-self: start;
  }
</style>
