<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { invalidateAll } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { hueFor } from '#lib/settings/guide.ts';
  import { useT } from '#lib/i18n/index.ts';
  import type { WorkerUnit } from '#lib/server/worker.ts';

  let { data, form } = $props();
  const t = useT();

  const s = $derived(data.status);
  const units = $derived(s?.units ?? []);
  const jobs = $derived(units.filter((u) => u.kind === 'job'));
  /** Every extension that has background work: its units, the host paths and keys they use. */
  const byExt = $derived.by(() => {
    const out = new Map<string, WorkerUnit[]>();
    for (const u of units) out.set(u.ext, [...(out.get(u.ext) ?? []), u]);
    return [...out.entries()];
  });
  const extName = (id: string) => data.names[id] ?? id;
  const unitName = (key: string) => {
    const [ext, name] = key.split('/');
    return `${extName(ext)} · ${name}`;
  };

  const time = (iso: string) =>
    iso ? new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  function ago(iso: string): string {
    const at = Date.parse(iso);
    if (!at) return '';
    const min = Math.round((Date.now() - at) / 60_000);
    if (min < 1) return t('just now');
    if (min < 60) return t('{n} min ago', { n: min });
    if (min < 48 * 60) return t('{n} h ago', { n: Math.round(min / 60) });
    return t.n(Math.round(min / 1440), '{n} day ago', '{n} days ago');
  }
  function until(iso: string): string {
    const at = Date.parse(iso);
    if (!at) return '';
    const min = Math.round((at - Date.now()) / 60_000);
    if (min < 1) return t('in under a minute');
    if (min < 60) return t('in {n} min', { n: min });
    if (min < 48 * 60) return t('in {n} h', { n: Math.round(min / 60) });
    return t.n(Math.round(min / 1440), 'in {n} day', 'in {n} days');
  }
  const mb = (bytes: number | null) => (bytes == null ? '' : `${Math.round(bytes / 1_048_576)} MB`);
  const schedule = (u: WorkerUnit) =>
    u.schedule.startsWith('every ') ? t('every {interval}', { interval: u.schedule.slice(6) }) : u.schedule.replace(/^cron /, t('cron') + ' ');

  function stateOf(u: WorkerUnit): { label: string; tone: string } {
    if (u.state === 'running') return { label: u.kind === 'job' ? t('Running now') : t('Running'), tone: 'good' };
    if (u.state === 'backoff') return { label: t('Crashed, restarting'), tone: 'serious' };
    if (u.state === 'starting') return { label: t('Starting'), tone: 'warning' };
    if (u.state === 'failed') return { label: t('Cannot start'), tone: 'critical' };
    if (u.lastRun && u.lastRun.exit !== 0 && u.lastRun.exit !== null) return { label: t('Last run failed'), tone: 'serious' };
    return { label: t('Waiting'), tone: '' };
  }
  const head = $derived(
    !s ? { label: t('Not started yet'), tone: 'warning' } : data.alive ? { label: t('Running'), tone: 'good' } : { label: t('Not running'), tone: 'critical' }
  );

  // Live: the worker rewrites its status every few seconds.
  $effect(() => {
    const timer = setInterval(() => invalidateAll(), 5000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>{t('Worker')} · {t('System settings')}</title></svelte:head>

<div class="head">
  <p class="eyebrow"><a href="/settings">{t('System settings')}</a></p>
  <div class="name">
    <Mascot mood={data.alive ? 'steady' : 'tired'} size={48} decorative />
    <h1>{t('Worker')}</h1>
    <span class="status small {head.tone}">{head.label}</span>
  </div>
  <p class="muted">
    {t('Runs the background work of your apps: services that run all the time and scheduled runs.')}
    {t('Installing or updating an app is enough: the worker picks it up within seconds.')}
  </p>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

{#if !s}
  <div class="card none">
    <Mascot mood="asleep" size={44} decorative />
    <p class="muted">
      {t('The worker has not reported yet. It is built and started by the next update of the app (System settings -> Updates), or by')}
      <code>sudo ./beni.sh install</code> {t('on the host.')}
    </p>
  </div>
{:else}
  {#if !data.alive}
    <p class="note bad" role="alert">
      {t('No word from the worker since {time}: its services and scheduled runs are stopped.', { time: time(s.at) })}
      {t('On the host:')} <code>docker compose up -d worker</code>
    </p>
  {/if}

  {#if s.problems.length}
    <section aria-labelledby="problems-h">
      <h2 id="problems-h">{t('Not started')}</h2>
      <ul class="menu card">
        {#each s.problems as p, i (i)}
          <li><strong>{extName(p.ext)}</strong> <span class="meta bad">{p.message}</span></li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="access-h">
    <h2 id="access-h">{t('What it can reach')}</h2>
    <ul class="menu card">
      {#each s.access as a (a.name)}
        <li class="row">
          <span class="mark" style="--hue: var(--hue-aqua)" aria-hidden="true">⌂</span>
          <span class="what">
            <strong><code>{a.source}</code> {t('of this machine')}</strong>
            <span class="meta">{a.what} · {t('at {path} in the worker', { path: a.path })}</span>
            <span class="meta">
              {#if a.usedBy.length}{t('Used by')} {a.usedBy.map(unitName).join(', ')}{:else}{t('Not used by any app')}{/if}
            </span>
          </span>
          {#if a.mounted && a.readonly}<span class="status small good">{t('Read-only')}</span>
          {:else if a.mounted}<span class="status small critical">{t('Writable')}</span>
          {:else}<span class="status small">{t('Not mounted')}</span>{/if}
        </li>
      {/each}
      <li class="row">
        <span class="mark" style="--hue: var(--hue-blue)" aria-hidden="true">⌘</span>
        <span class="what">
          <strong>{t('Host name')}</strong>
          <span class="meta">{t("The machine's own ({name}), so apps can show it.", { name: s.hostname })}</span>
        </span>
        <span class="status small good">{t('Read-only')}</span>
      </li>
      <li class="row">
        <span class="mark" style="--hue: var(--hue-violet)" aria-hidden="true">◫</span>
        <span class="what">
          <strong>{t('Database')}</strong>
          <span class="meta">
            {s.database
              ? t('Each app logs in as its own role (ext_<id>_svc), with its own password: its own tables, nothing of the others.')
              : t('No login for apps: SERVICES_DB_PASSWORD is not set in .env.')}
          </span>
        </span>
      </li>
      {#each s.keys as k (k.name)}
        <li class="row">
          <span class="mark" style="--hue: var(--hue-orange)" aria-hidden="true">⚿</span>
          <span class="what">
            <strong><code>{k.name}</code></strong>
            <span class="meta">{k.what}{k.set ? '' : ` · ${t('not set')}`}</span>
            <span class="meta">{#if k.usedBy.length}{t('Given to')} {k.usedBy.map(unitName).join(', ')}{:else}{t('Given to no app')}{/if}</span>
          </span>
        </li>
      {/each}
    </ul>
    <p class="meta">
      {t('Never: the Docker socket, ports, the .env file, the app logs or another app files. Each app runs as its own user, and cannot read the environment of other processes.')}
    </p>
  </section>

  <section aria-labelledby="jobs-h">
    <h2 id="jobs-h">{t('Scheduled runs')}</h2>
    {#if jobs.length}
      <div class="card table" role="table" aria-label={t('Scheduled runs')}>
        <div class="tr th" role="row">
          <span role="columnheader">{t('Run')}</span>
          <span role="columnheader">{t('When')}</span>
          <span role="columnheader">{t('Last run')}</span>
          <span role="columnheader">{t('Next run')}</span>
        </div>
        {#each jobs as j (j.key)}
          {@const st = stateOf(j)}
          <div class="tr" role="row">
            <span role="cell"><a href="#{j.ext}">{unitName(j.key)}</a></span>
            <span role="cell"><code>{schedule(j)}</code></span>
            <span role="cell">
              {#if j.state === 'running'}<span class="status small good">{t('Running now')}</span>
              {:else if j.lastRun}<span class="status small {st.tone || 'good'}">{j.lastRun.exit === 0 ? t('ok') : t('exit {code}', { code: j.lastRun.exit ?? '?' })}</span>
                <span class="meta">{ago(j.lastRun.start)}{j.lastRun.duration != null ? ` · ${j.lastRun.duration} s` : ''}</span>
              {:else}<span class="meta">{t('never')}</span>{/if}
            </span>
            <span role="cell" class="meta">{j.nextRun ? `${time(j.nextRun)} (${until(j.nextRun)})` : '—'}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">{t('No app has scheduled runs.')}</p>
    {/if}
  </section>

  <section aria-labelledby="apps-h">
    <h2 id="apps-h">{t('Apps that use it')}</h2>
    {#if !byExt.length}
      <div class="card none"><Mascot mood="idle" size={44} decorative /><p class="muted">{t('No installed app has background work yet.')}</p></div>
    {/if}
    {#each byExt as [ext, list] (ext)}
      <div class="card app" id={ext}>
        <div class="app-head">
          <span class="dot" style="--hue: {hueFor(ext)}" aria-hidden="true"></span>
          <h3>{extName(ext)}</h3>
          <span class="meta">{t('user {uid}', { uid: list[0].uid ?? '?' })}</span>
          <a class="meta" href="/settings/extensions/{ext}">{t('Its settings')}</a>
        </div>
        {#each list as u (u.key)}
          {@const st = stateOf(u)}
          <div class="unit">
            <div class="row">
              <span class="what">
                <strong>{u.name} <span class="kind">{u.kind === 'job' ? t('scheduled run') : t('service')}</span></strong>
                {#if u.description}<span class="meta">{u.description}</span>{/if}
                <span class="meta">
                  {#if u.kind === 'service'}
                    {#if u.since}{t('up since {time}', { time: time(u.since) })}{/if}
                    {#if u.restarts}· {t.n(u.restarts, '{n} restart', '{n} restarts')}{/if}
                    {#if u.lastExit !== null && u.state !== 'running'}· {t('last exit {code} {ago}', { code: u.lastExit, ago: ago(u.lastExitAt) })}{/if}
                  {:else}
                    <code>{schedule(u)}</code> · {t('stops after {time}', { time: u.timeout })}
                    {#if u.nextRun}· {t('next {when}', { when: until(u.nextRun) })}{/if}
                  {/if}
                  {#if u.rss}· {mb(u.rss)}{/if}
                </span>
              </span>
              <span class="status small {st.tone}">{st.label}</span>
              {#if u.kind === 'service'}
                <form method="POST" action="?/restart" use:enhance>
                  <input type="hidden" name="unit" value={u.key} />
                  <button class="btn" disabled={!data.alive}>{t('Restart')}</button>
                </form>
              {:else}
                <form method="POST" action="?/run" use:enhance>
                  <input type="hidden" name="unit" value={u.key} />
                  <button class="btn" disabled={!data.alive || u.state === 'running'}>{t('Run now')}</button>
                </form>
              {/if}
            </div>
            <dl class="facts">
              <dt>{t('Runs')}</dt>
              <dd><code>{u.run}</code> <span class="meta">{t('in {dir}', { dir: u.dir })}</span></dd>
              <dt>{t('Reaches')}</dt>
              <dd>
                {[
                  ...(s.database ? [t('its database tables')] : []),
                  ...u.host.map((h) => s.access.find((a) => a.name === h)?.source ?? h),
                  ...u.keys,
                  ...u.env.map((e) => `${e} (${t('set by the app')})`)
                ].join(', ') || t('nothing beyond its own folder')}
              </dd>
            </dl>
            <details>
              <summary>{t('Last log lines')}</summary>
              {#if data.logs[u.key]?.length}
                <pre class="log">{data.logs[u.key].join('\n')}</pre>
              {:else}
                <p class="meta">{t('Nothing logged yet.')}</p>
              {/if}
              {#if u.log}<a class="meta" href="/settings/logs?file={encodeURIComponent(u.log)}">{t('Whole log')}</a>{/if}
            </details>
          </div>
        {/each}
      </div>
    {/each}
  </section>

  {#if s.external.length}
    <section aria-labelledby="ext-h">
      <h2 id="ext-h">{t('In their own containers')}</h2>
      <ul class="menu card">
        {#each s.external as e (e.ext + e.name)}
          <li><strong>{extName(e.ext)} · {e.name}</strong> <span class="meta">{t('from the app compose.yml: started by ./install.sh on the host, not by the worker')}</span></li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .head {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  section {
    margin-top: var(--space-5);
  }
  .note {
    margin: 0 0 var(--space-3);
  }
  .bad {
    color: var(--critical);
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .none p {
    margin: 0;
  }
  .menu {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4);
  }
  .menu li {
    padding: var(--space-3) 0;
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
  }
  section > .meta {
    margin: var(--space-2) 0 0;
  }
  .table {
    display: grid;
    padding: var(--space-2) var(--space-4);
  }
  .tr {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1.2fr 1.3fr;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) 0;
  }
  .tr + .tr {
    border-top: 1px solid var(--ring);
  }
  .th {
    font-size: 0.75rem;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .app {
    padding: var(--space-3) var(--space-4);
    margin-top: var(--space-3);
  }
  .app-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .app-head h3 {
    margin: 0;
    flex: 1;
    font-size: 1rem;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--hue);
  }
  .unit {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--ring);
    margin-top: var(--space-3);
  }
  .kind {
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--ink-3);
    margin-left: 4px;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px var(--space-3);
    margin: var(--space-2) 0;
    font-size: 0.8125rem;
  }
  .facts dt {
    color: var(--ink-3);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  summary {
    cursor: pointer;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .log {
    margin: var(--space-2) 0;
    padding: var(--space-2) var(--space-3);
    max-height: 260px;
    overflow: auto;
    background: var(--surface-2);
    border-radius: 8px;
    font: 0.75rem/1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 640px) {
    .tr {
      grid-template-columns: 1fr 1fr;
    }
    .th {
      display: none;
    }
    .row {
      flex-wrap: wrap;
    }
  }
</style>
