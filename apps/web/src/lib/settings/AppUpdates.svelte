<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { askAgent } from '#lib/dock/dock.svelte.ts';
  import { compareVersions, type ExtUpdates } from '#lib/settings/ext-updates.ts';
  import { hueFor, initials, updatePrompt } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';

  /**
   * System settings -> Apps: the installed apps with a newer version in the extensions repo. "Update all" (or one
   * app's Update) asks the AI in the chat to run `ext update`, the same way apps are installed and removed; the
   * card then follows the rebuild until the running app has the new versions. Versions that need a newer core
   * wait for System settings -> Updates.
   */
  let { updates }: { updates: ExtUpdates } = $props();
  const t = useT();

  /** Ids asked to update, with the version each should reach. */
  let asked = $state<Record<string, string>>({});
  const busy = $derived(Object.keys(asked).length > 0);
  let timer: ReturnType<typeof setInterval> | undefined;

  function update(ids: string[]) {
    if (!ids.length) return;
    asked = { ...asked, ...Object.fromEntries(updates.ready.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.to])) };
    void askAgent(updatePrompt(ids));
    clearInterval(timer);
    // Done when the running app has every asked version; it may not answer while it rebuilds.
    timer = setInterval(async () => {
      try {
        const res = await fetch('/settings/extensions/installed.json', { cache: 'no-store' });
        if (!res.ok) return;
        const list: { id: string; version: string }[] = await res.json();
        const done = Object.entries(asked).every(([id, to]) => {
          const v = list.find((e) => e.id === id)?.version;
          return v !== undefined && compareVersions(v, to) >= 0;
        });
        if (done) {
          clearInterval(timer);
          asked = {};
          await invalidateAll();
        }
      } catch {
        /* rebuilding */
      }
    }, 3000);
  }
  onDestroy(() => clearInterval(timer));
</script>

{#if updates.ready.length || updates.waiting.length}
  <section class="sec" aria-labelledby="app-updates-h">
    <div class="card box">
      <div class="top">
        <Mascot mood="charged" size={44} decorative />
        <div class="what">
          <strong id="app-updates-h">
            {updates.ready.length
              ? t.n(updates.ready.length, 'One app update', '{n} app updates')
              : t('App updates need a newer core')}
          </strong>
          <span class="meta">
            {busy ? t('Updating… the chat runs it, and the app rebuilds itself in about a minute.') : t('New versions from the extensions repo. Their data stays.')}
          </span>
        </div>
        {#if updates.ready.length > 1}
          <button type="button" class="btn btn-primary" disabled={busy} onclick={() => update(updates.ready.map((u) => u.id))}>
            {busy ? t('Updating…') : t('Update all')}
          </button>
        {/if}
      </div>
      <ul class="rows">
        {#each updates.ready as u (u.id)}
          <li>
            <span class="mark" style="--hue: {hueFor(u.id)}" aria-hidden="true">{initials(u.name)}</span>
            <span class="what">
              <strong>{u.name}</strong>
              <span class="meta num">{u.from} → {u.to}</span>
            </span>
            <button type="button" class="btn" class:btn-primary={updates.ready.length === 1} disabled={busy} onclick={() => update([u.id])}>
              {asked[u.id] ? t('Updating…') : t('Update')}
            </button>
          </li>
        {/each}
        {#each updates.waiting as u (u.id)}
          <li>
            <span class="mark" style="--hue: {hueFor(u.id)}" aria-hidden="true">{initials(u.name)}</span>
            <span class="what">
              <strong>{u.name}</strong>
              <span class="meta num">{u.from} → {u.to} · {t('needs a newer core')}</span>
            </span>
            <a class="btn go" href="/settings/updates">{t('Updates')}</a>
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}

<style>
  .box {
    border-left: 4px solid var(--accent);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--ring);
  }
  .btn {
    flex: none;
    min-height: 44px;
  }
  /* The settings list stretches a row's link; this one is a button. */
  .rows > li > .btn.go {
    flex: none;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 560px) {
    .top {
      flex-wrap: wrap;
    }
    .top .btn {
      width: 100%;
    }
  }
</style>
