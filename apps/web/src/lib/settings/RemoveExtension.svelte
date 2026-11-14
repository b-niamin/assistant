<script lang="ts">
  import { onDestroy } from 'svelte';
  import { dock, runInDock } from '#lib/dock/dock.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  /**
   * "Remove" at the bottom of an extension's panel: a confirmation, then `ext remove` in the terminal (the
   * same way apps are installed). With "Also delete its data", ext-migrate drops its schema, roles,
   * settings and secrets within ~15 s. The page follows the app's rebuild and goes back to Apps.
   */
  let { id, name, native }: { id: string; name: string; native: boolean } = $props();
  const t = useT();

  let dialog = $state<HTMLDialogElement>();
  let withData = $state(false);
  let handoff = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const sending = $derived(handoff > 0 && dock.handoff?.n === handoff && dock.handoff?.state === 'waiting');

  function open() {
    withData = false;
    dialog?.showModal();
  }
  function remove() {
    handoff = runInDock(`node scripts/ext.mjs remove ${id}${withData ? ' --data' : ''}`);
    // Gone from the running app = removed and rebuilt; the app may not answer while it rebuilds.
    timer = setInterval(async () => {
      try {
        const res = await fetch('/settings/extensions/installed.json', { cache: 'no-store' });
        if (!res.ok) return;
        const list: { id: string }[] = await res.json();
        if (!list.some((e) => e.id === id)) {
          clearInterval(timer);
          location.assign('/settings/apps');
        }
      } catch {
        /* rebuilding */
      }
    }, 2000);
  }
  onDestroy(() => clearInterval(timer));
</script>

<section>
  <h2>{t('Remove')}</h2>
  <p class="card row">
    <span class="meta">{t('Takes {name} out of the app: its pages, tiles, AI tools and background jobs.', { name })}</span>
    <button type="button" class="btn danger" onclick={open}>{t('Remove {name}', { name })}</button>
  </p>
</section>

<dialog bind:this={dialog} class="card" aria-labelledby="remove-title">
  <h2 id="remove-title">{t('Remove {name}?', { name })}</h2>
  {#if handoff}
    <p role="status">
      {sending ? t('Opening the terminal…') : t('Removing… the app rebuilds itself without {name}, about a minute.', { name })}
    </p>
  {:else}
    <p>{t('Its pages, tiles, AI tools and background jobs go away.')}</p>
    <label class="check">
      <input type="checkbox" bind:checked={withData} />
      <span>
        {t('Also delete its data')}
        <span class="muted small">
          {native
            ? t('Everything it stored, for every profile: its tables, settings, secrets and files. This cannot be undone.')
            : t('Everything it stored, for every profile: its saved state, settings and secrets. This cannot be undone.')}
        </span>
      </span>
    </label>
    {#if !withData}<p class="muted small">{t('Its data stays and comes back if you install it again.')}</p>{/if}
    <div class="actions">
      <button type="button" class="btn" onclick={() => dialog?.close()}>{t('Cancel')}</button>
      <button type="button" class="btn danger" onclick={remove}>{withData ? t('Remove with data') : t('Remove')}</button>
    </div>
  {/if}
</dialog>

<style>
  section {
    margin-bottom: var(--space-5);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3) var(--space-4);
  }
  .danger {
    color: var(--critical-ink);
    font-weight: var(--weight-medium);
  }
  @media (hover: hover) {
    .danger:hover {
      border-color: var(--critical);
    }
  }
  dialog {
    width: min(440px, calc(100vw - 32px));
    color: var(--ink);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  dialog h2 {
    margin: 0 0 var(--space-2);
  }
  dialog p {
    margin: 0 0 var(--space-3);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .check > span {
    display: grid;
    gap: 2px;
  }
  .check input {
    margin-top: 3px;
  }
  .small {
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
