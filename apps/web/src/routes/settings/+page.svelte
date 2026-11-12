<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { page } from '$app/state';
  import Mascot from '#lib/Mascot.svelte';
  import { AGENT_NAMES, lockSession, openDock, refreshDock } from '#lib/dock/dock.svelte.ts';
  import { hueFor, initials } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();
  const next = $derived(page.url.searchParams.get('next') ?? '');
  const date = (iso: string) => new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  /** The tiles: one per part of the system that can need you, each with its state in words and a dot. */
  const tiles = $derived.by(() => {
    if (data.locked || !data.status) return [];
    const s = data.status;
    const signedIn = (['claude', 'codex', 'gh'] as const).filter((k) => data.terminal[k]).length;
    return [
      {
        href: '/settings/updates',
        title: t('Updates'),
        tone: s.updates.tone,
        value: s.updates.pendingRestart && s.updates.state === 'ok' ? t('Restart needed') : {
          none: t('Not set up'),
          stale: t('The updater is not running'),
          interrupted: t('Update interrupted'),
          updating: t('Updating'),
          available: t('Update available'),
          ok: t('Up to date'),
          failed: t('Last update failed'),
          blocked: t('Updates paused')
        }[s.updates.state],
        meta: t('From GitHub main, by the host\'s updater')
      },
      {
        href: '/settings/backups',
        title: t('Backups'),
        tone: s.backups.tone,
        value: { none: t('No backup status yet'), running: t('Backing up'), failed: t('Last backup failed'), stale: t('Out of date'), ok: t('Up to date') }[s.backups.state],
        meta: s.backups.lastOk ? t('Last good backup {when}', { when: date(s.backups.lastOk) }) : t('No good backup yet.')
      },
      {
        href: '/settings/connector',
        title: t('Claude connector'),
        tone: s.connector.tone,
        value: { on: t('On'), off: t('Off'), turning: t('Turning on…'), error: t('Not reachable') }[s.connector.state],
        meta: t('Your apps in claude.ai and the Claude apps')
      },
      {
        href: '/settings/ai',
        title: t('Terminal and AI'),
        tone: !data.terminal.configured || !data.terminal.reachable ? 'off' : signedIn ? 'good' : 'warning',
        value: !data.terminal.configured
          ? t('Not set up')
          : !data.terminal.reachable
            ? t('Not answering')
            : t('{n} of 3 signed in', { n: signedIn }),
        meta: t('Default AI: {name}', { name: AGENT_NAMES[data.defaultAgent] })
      },
      {
        href: '/settings/worker',
        title: t('Worker'),
        tone: s.worker.tone,
        value: { none: t('No status yet'), down: t('Not running'), failed: t.n(s.worker.failed, 'One unit failing', '{n} units failing'), ok: t('Running') }[s.worker.state],
        meta: t.n(s.worker.units, 'One service or job', '{n} services and jobs')
      },
      {
        href: '/settings/apps',
        title: t('Apps'),
        tone: data.untranslated ? 'warning' : 'good',
        value: t.n(data.apps, 'One app', '{n} apps'),
        meta: data.untranslated ? t.n(data.untranslated, 'One app is not translated yet', '{n} apps are not translated yet') : t('Translated into every language')
      }
    ];
  });
  const attention = $derived(tiles.filter((x) => x.tone === 'critical' || x.tone === 'warning').length);
</script>

<svelte:head><title>{t('System settings')} · {t('Assistant')}</title></svelte:head>

{#if data.locked}
  <div class="locked">
    <Mascot mood="asleep" size={72} decorative />
    <form method="POST" action={next ? `?/unlock&next=${encodeURIComponent(next)}` : '?/unlock'} class="card unlock"
      use:enhance={() => async ({ update }) => (await update(), refreshDock())}>
      <h1>{t('System settings')}</h1>
      <p class="muted">{t('Settings change what everybody sees, so they ask for the password again. They stay open for 10 minutes.')}</p>
      {#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
      <label>
        <span class="sr">{t('App password')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="password" name="password" autocomplete="current-password" placeholder={t('App password')} required autofocus />
      </label>
      <button class="btn btn-primary">{t('Unlock')}</button>
    </form>
  </div>
{:else}
  <div class="hero">
    <Mascot mood={attention ? 'tired' : 'steady'} size={64} decorative />
    <div class="title">
      <h1>{t('Settings')}</h1>
      <p class="lede">{attention ? t.n(attention, 'One thing needs you.', '{n} things need you.') : t('Everything is running.')}</p>
    </div>
    <form method="POST" action="?/lock" use:enhance={() => async ({ update }) => (await update(), await lockSession())}>
      <button class="btn" title={t('Settings and the terminal close on this device until the password is typed again.')}>{t('Lock')}</button>
    </form>
  </div>

  {#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
  {#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}
  {#if page.url.searchParams.has('welcome')}
    <p class="note good">{t('All set. Add apps and the other people at home here; everything else lives on the dashboard.')}</p>
  {/if}
  {#if data.status?.build.failed}
    <p class="note bad" role="alert">
      <strong>{t('The latest change to the app did not build')}</strong><br />
      <span class="meta">{t('The previous version keeps running. The reason is in the log of web.')} <a href="/settings/logs">{t('Logs')}</a></span>
    </p>
  {/if}

  <section class="sec" aria-labelledby="state-h">
    <h2 id="state-h" class="sr">{t('State of the system')}</h2>
    <ul class="tiles">
      {#each tiles as tile (tile.href)}
        <li>
          <a class="card tile {tile.tone}" href={tile.href}>
            <span class="meta">{tile.title}</span>
            <strong><span class="dot" aria-hidden="true"></span>{tile.value}</strong>
            <span class="meta small">{tile.meta}</span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  <section class="sec" aria-labelledby="do-h">
    <h2 id="do-h">{t('Common tasks')}</h2>
    <div class="quick">
      <a class="card do" href="/settings/extensions/new" style="--hue: var(--hue-orange)">
        <span class="mark" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span>
        <span class="what"><strong>{t('Extend the system')}</strong><span class="meta">{t('Install an app or let AI build one')}</span></span>
      </a>
      <a class="card do" href="/settings/profiles#add" style="--hue: var(--hue-blue)">
        <span class="mark" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="8" cy="7" r="3" /><path d="M2.5 16c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15 6v6M12 9h6" /></svg></span>
        <span class="what"><strong>{t('Add a person')}</strong><span class="meta">{t('A profile with their own data')}</span></span>
      </a>
      <button type="button" class="card do" onclick={openDock} style="--hue: var(--hue-violet)">
        <span class="mark" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 6l4 4-4 4M10 14h6" /></svg></span>
        <span class="what"><strong>{t('Open the terminal')}</strong><span class="meta">{t('Claude Code, Codex, a shell')}</span></span>
      </button>
    </div>
  </section>

  <section class="sec" aria-labelledby="people-h">
    <div class="sec-h">
      <h2 id="people-h">{t('People at home')}</h2>
      <a class="meta" href="/settings/profiles">{t('Manage')}</a>
    </div>
    <div class="faces">
      {#each data.profiles as p (p.id)}
        <a class="face" href="/settings/profiles">
          <span class="avatar" style="--hue: {hueFor(p.id)}" aria-hidden="true">{initials(p.name)}</span>
          <span class="pname">{p.name}</span>
        </a>
      {/each}
      <a class="face" href="/settings/profiles#add">
        <span class="avatar plus" aria-hidden="true">+</span>
        <span class="pname">{t('Add')}</span>
      </a>
    </div>
  </section>
{/if}

<style>
  .locked {
    display: grid;
    justify-items: center;
    gap: var(--space-4);
    max-width: 420px;
    margin: var(--space-6) auto;
  }
  .unlock {
    display: grid;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-5);
  }
  .unlock h1,
  .unlock p {
    margin: 0;
  }
  .unlock h1 {
    font-size: var(--text-xl);
  }
  .unlock input {
    width: 100%;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .hero h1,
  .hero p {
    margin: 0;
  }
  .hero form {
    margin: 0;
  }
  .lede {
    color: var(--ink-2);
  }
  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .tile {
    display: grid;
    gap: var(--space-1);
    height: 100%;
    box-sizing: border-box;
    padding: var(--space-3) var(--space-4);
    color: inherit;
    text-decoration: none;
    transition: border-color 120ms;
  }
  .tile:hover {
    border-color: var(--axis);
  }
  .tile strong {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ink-4);
  }
  .good .dot {
    background: var(--good);
  }
  .warning .dot {
    background: var(--warning);
  }
  .critical .dot {
    background: var(--critical);
  }
  .accent .dot {
    background: var(--accent);
  }
  .tile.critical {
    border-color: color-mix(in srgb, var(--critical) 45%, var(--ring));
  }
  .small {
    font-size: var(--text-xs);
  }
  .quick {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .do {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    font: inherit;
    text-align: left;
    color: var(--ink);
    text-decoration: none;
    cursor: pointer;
  }
  .do:hover {
    border-color: var(--hue);
  }
  .faces {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .face {
    display: grid;
    justify-items: center;
    gap: 4px;
    width: 64px;
    color: inherit;
    text-decoration: none;
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--hue) 18%, transparent);
    color: var(--hue);
    font-weight: 700;
    box-sizing: border-box;
  }
  .avatar.plus {
    background: none;
    border: 1.5px dashed var(--axis);
    color: var(--ink-2);
    font-size: 1.1rem;
  }
  .pname {
    font-size: var(--text-sm);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
