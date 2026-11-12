<script lang="ts">
  import { enhance, saveOnChoose } from '#lib/forms.ts';
  import { invalidate } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import PageHead from '#lib/settings/PageHead.svelte';
  import { useT } from '#lib/i18n/index.ts';

  let { data, form } = $props();
  const t = useT();

  /** "6 Nov, 23:02 (3 days ago)": the date in this browser's time zone, plus how long ago. */
  function when(iso: string): string {
    const at = Date.parse(iso);
    if (!at) return '';
    const date = new Date(at).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const min = Math.round((Date.now() - at) / 60_000);
    const ago =
      min < 1
        ? t('just now')
        : min < 60
          ? t('{n} min ago', { n: min })
          : min < 48 * 60
            ? t('{n} h ago', { n: Math.round(min / 60) })
            : t.n(Math.round(min / 1440), '{n} day ago', '{n} days ago');
    return `${date} (${ago})`;
  }
  const short = (sha: string) => sha.slice(0, 7);
  /** States in which a newer commit on GitHub means "Update" (not while one runs or the updater is gone). */
  const state0 = (s: string) => s === 'ok' || s === 'available' || s === 'failed' || s === 'blocked';

  // While an update runs or is asked for, follow it: the page reloads its data every 5 seconds.
  $effect(() => {
    if (!(data.updates?.status === 'updating' || data.updateView?.pending || data.updateView?.restartPending)) return;
    const timer = setInterval(() => invalidate('app:updates'), 5000);
    return () => clearInterval(timer);
  });

  // GitHub's main arrives after the page (streamed from the load).
  let latestSha = $state<string | null>(null);
  $effect(() => {
    const p = data.latestSha;
    let live = true;
    Promise.resolve(p).then((v) => live && (latestSha = v ?? null));
    return () => (live = false);
  });
</script>

<svelte:head><title>{t('Updates')} · {t('System settings')}</title></svelte:head>

<PageHead title={t('Updates')} lede={t('The host\'s updater deploys what is on GitHub main and rebuilds only what changed.')} />

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

{#if data.updates && data.updateView}
  {@const u = data.updates}
  {@const v = data.updateView}
  <!-- main on GitHub, asked as the page opened: a newer commit than the running one is an update now. -->
  {@const newer = !!latestSha && latestSha !== u.deployedSha && state0(v.state)}
  {@const state = newer && v.state === 'ok' ? 'available' : v.state}
  {@const target = newer ? latestSha! : u.sha}
  {@const cancelling = !!data.updateControl.cancel && Date.parse(data.updateControl.cancel) > Date.parse(u.startedAt || u.at)}
  {@const title = {
    stale: t('The updater is not running'),
    interrupted: t('Update to {sha} interrupted', { sha: short(u.sha) }),
    updating: t('Updating to {sha}', { sha: short(u.sha) }),
    available: t('Update available: {sha}', { sha: short(target) }),
    ok: t('Up to date'),
    failed: t('Last update failed'),
    blocked: t('Updates paused')
  }[state]}
  {@const mood = state === 'ok' ? 'steady' : state === 'available' || state === 'updating' ? 'charged' : state === 'stale' ? 'asleep' : 'tired'}

  <section class="sec" aria-label={t('Update state')}>
    <div class="card hero {state}">
      <Mascot {mood} size={56} decorative />
      <div class="what">
        <strong class="big">{v.unanswered ? t('Waiting for the updater') : v.pending && state !== 'updating' ? t('Starting the update…') : title}</strong>
        <span class="meta">
          {#if u.deployedSha}{t('Running')} <code>{short(u.deployedSha)}</code>{u.deployedAt ? ` · ${t('deployed {when}', { when: when(u.deployedAt) })}` : ''}{/if}
        </span>
      </div>
      <div class="acts">
        {#if state === 'updating' || state === 'interrupted'}
          {#if state === 'interrupted'}
            <form method="POST" action="?/updateNow" use:enhance>
              <button class="btn btn-primary" disabled={v.pending}>{v.pending ? t('Resuming…') : t('Resume')}</button>
            </form>
          {/if}
          <form method="POST" action="?/updateCancel" use:enhance>
            <button class="btn" disabled={cancelling} title={t('Stops the update; the containers that run now keep running')}>
              {cancelling ? t('Cancelling…') : t('Cancel')}
            </button>
          </form>
        {:else if state !== 'stale' && (state !== 'ok' || !latestSha || v.pending)}
          <!-- Up to date with GitHub as of now: nothing to click. Unknown (GitHub did not answer): Update asks the updater. -->
          <form method="POST" action="?/updateNow" use:enhance>
            <button class="btn" class:btn-primary={state === 'available' || state === 'failed'} disabled={v.pending}>
              {v.pending ? t('Requested…') : state === 'failed' ? t('Try again') : t('Update')}
            </button>
          </form>
        {/if}
      </div>

      {#if v.unanswered}
        <p class="full meta bad">
          {t('Requested {when}, but the updater has not taken it: is its scheduled task running every minute, all day? (In DSM its last run time must be 23:59.)', { when: when(data.updateControl.request) })}
          {t('On the host,')} <code>sudo ./beni.sh update</code> {t('updates right away.')}
        </p>
      {:else if v.pending}
        <p class="full meta">{t('Requested {when}: the updater takes it within a minute.', { when: when(data.updateControl.request) })}</p>
      {/if}

      {#if state === 'stale'}
        <p class="full meta">
          {t('No sign of it since {when}, so new commits on {branch} are not deployed.', { when: when(u.checkedAt || u.at), branch: u.branch })}
          {t('Its scheduled task must run')} <code>sh &lt;folder&gt;-updater/update.sh</code>
          {t('as root every minute, all day (DSM Task Scheduler: daily, every minute, first run 00:00, last run time 23:59);')}
          <code>sudo ./beni.sh doctor</code> {t('checks it, and')}
          <code>sudo ./beni.sh auto-update install</code> {t('prints the exact command.')} <code>sudo ./beni.sh update</code> {t('updates by hand.')}
        </p>
      {:else if state === 'updating' || state === 'interrupted'}
        <div class="full progress" class:halted={state === 'interrupted'} role="progressbar" aria-valuemin="0" aria-valuemax={u.steps || 1} aria-valuenow={u.step} aria-label={t('Update progress')}>
          <span style="width: {u.steps ? Math.max(4, ((u.step - 0.5) / u.steps) * 100) : 4}%" class:indeterminate={!u.steps && state === 'updating'}></span>
        </div>
        <p class="full meta">
          {#if u.steps}{t('Step {step} of {steps}:', { step: u.step, steps: u.steps })} <strong>{u.message}</strong>{:else}{u.message}{/if}
          {#if u.startedAt} · {t('started {when}', { when: when(u.startedAt) })}{/if}{#if u.attempt > 1} · {t('attempt {n}', { n: u.attempt })}{/if}.
          {#if state === 'updating'}
            {t('A build takes minutes on a NAS; the old containers keep running until then.')}
          {:else}
            {t('Its process stopped (no sign of it since {when}: a restart of the host, or it was killed). The updater\'s next run picks it up where it stopped; Resume asks for that now, and so does', { when: when(u.checkedAt || u.at) })}
            <code>sudo ./beni.sh update</code> {t('on the host.')}
          {/if}
        </p>
        {#if data.buildTail.length}
          <pre class="full tail" aria-label={t('Build output')}>{data.buildTail.join('\n')}</pre>
        {/if}
      {:else if u.status !== 'ok'}
        <p class="full meta">{u.message}</p>
        {#if state === 'failed' && data.buildTail.length}
          <details class="full">
            <summary>{t('Build output')}</summary>
            <pre class="tail">{data.buildTail.join('\n')}</pre>
          </details>
        {/if}
      {/if}
    </div>

    {#if u.pendingRestart && state !== 'updating'}
      <div class="card restart">
        <span class="mark" style="--hue: var(--warning)" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16 3.5v3.5h-3.5" /></svg></span>
        <p class="what">
          <strong>{t('Restart needed')}</strong>
          <span class="meta">
            {u.pendingRestart.split(' ').join(` ${t('and')} `)}
            {v.restartPending
              ? t('still run the previous version. Restarting them ends the Claude and Codex sessions and the terminal running there.')
              : t('still run the previous version. Restarting them ends the Claude and Codex sessions and the terminal running there, so it waits for you.')}
          </span>
        </p>
        <form method="POST" action="?/updateRestart" use:enhance>
          <button class="btn btn-primary" disabled={v.restartPending}>{v.restartPending ? t('Restarting…') : t('Restart now')}</button>
        </form>
      </div>
    {/if}
  </section>

  <section class="sec" aria-labelledby="how-h">
    <h2 id="how-h">{t('How updates happen')}</h2>
    <div class="two">
      <form method="POST" action="?/updateMode" use:enhance use:saveOnChoose class="card panel" aria-label={t('Update mode')}>
        <strong>{t('New versions')}</strong>
        <div class="choice">
          <label>
            <input type="radio" name="mode" value="auto" checked={data.updateControl.mode === 'auto'} />
            <span><strong>{t('Automatic')}</strong><span class="meta">{t('Deployed within minutes of reaching GitHub main.')}</span></span>
          </label>
          <label>
            <input type="radio" name="mode" value="manual" checked={data.updateControl.mode === 'manual'} />
            <span><strong>{t('Manual')}</strong><span class="meta">{t('Show new versions, update when I click.')}</span></span>
          </label>
        </div>
        <noscript><button class="btn">{t('Save')}</button></noscript>
      </form>
      <form method="POST" action="?/updateRestarts" use:enhance use:saveOnChoose class="card panel" aria-label={t('Restarts of the terminal')}>
        <strong>{t('Restarts of the terminal')}</strong>
        <div class="choice">
          <label>
            <input type="radio" name="restarts" value="ask" checked={data.updateControl.restarts !== 'auto'} />
            <span><strong>{t('Ask me first')}</strong><span class="meta">{t('A restart ends what runs in the terminal.')}</span></span>
          </label>
          <label>
            <input type="radio" name="restarts" value="auto" checked={data.updateControl.restarts === 'auto'} />
            <span><strong>{t('Restart it by itself')}</strong><span class="meta">{t('Best when nobody keeps sessions open there.')}</span></span>
          </label>
        </div>
        <noscript><button class="btn">{t('Save')}</button></noscript>
      </form>
    </div>
  </section>

  <section class="sec" aria-labelledby="det-h">
    <h2 id="det-h">{t('Details')}</h2>
    <div class="card panel">
      <dl class="facts">
        <dt>{t('Last change')}</dt><dd>{u.message}{u.at ? ` · ${when(u.at)}` : ''}</dd>
        <dt>GitHub {u.branch}</dt><dd>{#if latestSha}<code>{short(latestSha)}</code>, {t('checked as this page opened')}{:else}{t('not reachable from the app')}{/if}</dd>
        <dt>{t('Last check')}</dt><dd>{u.checkedAt ? when(u.checkedAt) : t('not reported')}</dd>
        {#if u.actions && state !== 'updating'}<dt>{t('Last actions')}</dt><dd><code>{u.actions}</code></dd>{/if}
      </dl>
      <p class="meta">
        {t('The host\'s updater runs every minute, checks {branch} on GitHub every few minutes and rebuilds only what changed.', { branch: u.branch })}
        {t('On the host the same update is')} <code>sudo ./beni.sh update</code>.
        <a href="/settings/logs?file=updater.log">{t('Updater log')}</a>
      </p>
    </div>
  </section>
{:else}
  <div class="card panel empty">
    <Mascot mood="asleep" size={48} decorative />
    <p class="muted">
      {t('The updater is not set up. On the host,')} <code>sudo ./beni.sh update</code>
      {t('sets it up and updates; it prints the scheduled task to add (spec 006).')}
    </p>
  </div>
{/if}

<style>
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-left: 4px solid var(--good);
  }
  .hero.available {
    border-left-color: var(--accent);
  }
  .hero.updating,
  .hero.interrupted,
  .hero.blocked {
    border-left-color: var(--warning);
  }
  .hero.failed,
  .hero.stale {
    border-left-color: var(--critical);
  }
  .big {
    font-size: var(--text-lg);
  }
  .acts {
    display: flex;
    gap: var(--space-2);
  }
  .acts form {
    margin: 0;
  }
  .full {
    grid-column: 1 / -1;
    margin: 0;
  }
  .bad {
    color: var(--critical-ink);
  }
  .restart {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .restart p {
    margin: 0;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-3);
  }
  .two form {
    margin: 0;
  }
  .progress {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 400ms ease;
  }
  .progress.halted span {
    background: var(--warning);
  }
  @media (prefers-reduced-motion: no-preference) {
    .progress span.indeterminate {
      width: 30% !important;
      animation: slide 1.4s ease-in-out infinite;
    }
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  .tail {
    max-height: 13em;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: #141413;
    color: #c9c7bf;
    font: var(--text-xs) / 1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
  }
  .facts dt {
    color: var(--ink-2);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .empty {
    display: flex;
    align-items: center;
  }
  code {
    font-size: var(--text-sm);
  }
  @media (max-width: 560px) {
    .hero {
      grid-template-columns: auto minmax(0, 1fr);
      padding: var(--space-4);
    }
    .acts {
      grid-column: 1 / -1;
    }
    .restart {
      flex-wrap: wrap;
    }
  }
</style>
