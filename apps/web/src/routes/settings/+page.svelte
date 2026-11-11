<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import Mascot from '#lib/Mascot.svelte';
  import { AGENT_NAMES, askAgent, lockSession, openDock, refreshDock, runInDock } from '#lib/dock/dock.svelte.ts';
  import { hueFor, initials } from '#lib/settings/guide.ts';
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
  const next = $derived(page.url.searchParams.get('next') ?? '');

  // Sign-ins for the terminal's CLIs; the commands run in the dock's terminal at the bottom.
  const TOOLS = $derived([
    { id: 'claude', name: 'Claude Code', mark: 'C', hue: 'var(--brand)', cmd: 'claude', hint: t('Then type /login and open the link it prints.') },
    { id: 'codex', name: 'Codex', mark: 'X', hue: 'var(--hue-aqua)', cmd: 'codex login --device-auth', hint: t('Sign in with ChatGPT: enter the code at the URL it prints.') },
    { id: 'gh', name: 'GitHub CLI', mark: 'G', hue: 'var(--hue-violet)', cmd: 'gh auth login', hint: t('Choose GitHub.com, HTTPS, then log in with a web browser.') }
  ] as const);

  // System settings -> Language (spec 007): which languages are ticked, and the default among them.
  let ticked = $state<string[] | null>(null);
  const enabledNow = $derived(ticked ?? (data.locked ? [] : data.languages.enabled));
  const missingApps = $derived(data.locked ? [] : data.languages.missing);
  const languageNames = $derived(new Map((data.locked ? [] : data.languages.all).map((l) => [l.code, l.name])));
  /** The request for the AI when apps lack a language: it translates them as the add-extension skill says. */
  const translateAsk = (missing: { id: string; langs: string[] }[]) =>
    `Translate these extensions into the app's languages (spec 007, add-extension skill): ` +
    missing.map((m) => `${m.id} (${m.langs.join(', ')})`).join('; ') +
    `. Check each with node scripts/ext.mjs check <id> until it prints no i18n: warnings.`;

  // While an update runs or is asked for, follow it: the page reloads its data every 5 seconds.
  $effect(() => {
    if (data.locked || !(data.updates?.status === 'updating' || data.updateView?.pending || data.updateView?.restartPending)) return;
    const t = setInterval(() => invalidate('app:updates'), 5000);
    return () => clearInterval(t);
  });

  // GitHub's main arrives after the page (streamed from the load).
  let latestSha = $state<string | null>(null);
  $effect(() => {
    const p = data.locked ? null : data.latestSha;
    let live = true;
    Promise.resolve(p).then((v) => live && (latestSha = v ?? null));
    return () => (live = false);
  });

  const whoSees = (ids: string[] | null, profiles: { id: string; name: string }[]) =>
    ids === null ? t('everyone') : ids.map((id) => profiles.find((p) => p.id === id)?.name ?? id).join(', ') || t('nobody');
</script>

<svelte:head><title>{t('System settings')} · {t('Assistant')}</title></svelte:head>

<div class="hero">
  <Mascot mood={data.locked ? 'asleep' : 'steady'} size={64} decorative />
  <div class="title">
    <h1>{t('System settings')}</h1>
    <p class="lede">{t('Apps, people, the terminal and security, all in one place.')}</p>
  </div>
  {#if !data.locked}
    <!-- Same lock as the header's: the terminal goes too. -->
    <form method="POST" action="?/lock" use:enhance={() => async ({ update }) => (await update(), await lockSession())}>
      <button class="btn">{t('Lock')}</button>
    </form>
  {/if}
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

{#if !data.locked && page.url.searchParams.has('welcome')}
  <p class="note good">{t('All set. Add apps and the other people at home here; everything else lives on the dashboard.')}</p>
{/if}

{#if data.locked}
  <form method="POST" action={next ? `?/unlock&next=${encodeURIComponent(next)}` : '?/unlock'} class="card unlock"
    use:enhance={() => async ({ update }) => (await update(), refreshDock())}>
    <h2>{t('Enter the app password again')}</h2>
    <p class="muted">{t('Settings change what everybody sees, so they ask for the password again. They stay open for 10 minutes.')}</p>
    <label>
      <span class="sr">{t('App password')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <button class="btn btn-primary">{t('Unlock')}</button>
  </form>
{:else}
  <nav class="quick" aria-label={t('Common tasks')}>
    <a class="card do" href="/settings/extensions/new" style="--hue: var(--hue-orange)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span>
      <strong>{t('Extend the system')}</strong>
      <span class="meta">{t('Install an app or let AI build one')}</span>
    </a>
    <a class="card do" href="/settings/profiles#add" style="--hue: var(--hue-blue)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="8" cy="7" r="3" /><path d="M2.5 16c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15 6v6M12 9h6" /></svg></span>
      <strong>{t('Add a person')}</strong>
      <span class="meta">{t('A profile with their own data')}</span>
    </a>
    <button type="button" class="card do" onclick={openDock} style="--hue: var(--hue-violet)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 6l4 4-4 4M10 14h6" /></svg></span>
      <strong>{t('Open the terminal')}</strong>
      <span class="meta">{t('At the bottom of every page: Claude Code, Codex, a shell')}</span>
    </button>
  </nav>

  <section aria-labelledby="apps-h">
    <div class="sh">
      <h2 id="apps-h">{t('Apps')}</h2>
      <span class="meta">{t('{n} installed', { n: data.extensions.length })}</span>
    </div>
    <ul class="menu card">
      {#each data.extensions as ext (ext.id)}
        <li>
          <a href="/settings/extensions/{ext.id}">
            <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
            <span class="what">
              <strong>{ext.name}</strong>
              <span class="meta">{ext.description || (ext.kind === 'native' ? t('Native app') : t('One-file app'))}</span>
            </span>
            <span class="state">
              <span class="status small" class:good={ext.enabled}>{ext.enabled ? `${t('On')} · ${whoSees(ext.profiles, data.profiles)}` : t('Off')}</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </a>
        </li>
      {:else}
        <li class="none">
          <Mascot mood="idle" size={48} decorative />
          <span class="muted">{t('No apps yet. Install a ready-made one or let Claude build one for you.')}</span>
        </li>
      {/each}
      <li>
        <a href="/settings/extensions/new" class="add">
          <span class="mark plus" aria-hidden="true">+</span>
          <span class="what"><strong>{t('Extend the system')}</strong><span class="meta">{t('Ready-made apps, inspirations, or your own idea')}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    </ul>
  </section>

  <section aria-labelledby="people-h">
    <div class="sh">
      <h2 id="people-h">{t('Profiles')}</h2>
      <a class="meta" href="/settings/profiles">{t('Manage')}</a>
    </div>
    <a class="card people" href="/settings/profiles">
      <span class="faces">
        {#each data.profiles as p (p.id)}
          <span class="face">
            <span class="avatar" style="--hue: {hueFor(p.id)}" aria-hidden="true">{initials(p.name)}</span>
            <span class="pname">{p.name}</span>
          </span>
        {/each}
        <span class="face">
          <span class="avatar plus" aria-hidden="true">+</span>
          <span class="pname">{t('Add')}</span>
        </span>
      </span>
      <span class="meta">{t('Everyone gets their own data and dashboard. Not accounts: the app password opens all.')}</span>
    </a>
  </section>

  <section aria-labelledby="lang-h">
    <h2 id="lang-h">{t('Language')}</h2>
    <form method="POST" action="?/languages" use:enhance={() => async ({ update }) => { await update(); ticked = null; }} class="card langs">
      <p class="meta">
        {t('The languages of the app. Every app (extension) is built in all of them: when one lacks a language, the AI translates it as it installs it.')}
      </p>
      <table>
        <thead>
          <tr><th scope="col">{t('Language')}</th><th scope="col">{t('Offered')}</th><th scope="col">{t('Default')}</th></tr>
        </thead>
        <tbody>
          {#each data.languages.all as l (l.code)}
            {@const on = enabledNow.includes(l.code)}
            <tr>
              <th scope="row" lang={l.code}>{l.name}</th>
              <td>
                <input
                  type="checkbox"
                  name="enabled"
                  value={l.code}
                  checked={on}
                  disabled={l.code === 'en'}
                  aria-label={t('Offer {name}', { name: l.name })}
                  onchange={(e) => (ticked = e.currentTarget.checked ? [...enabledNow, l.code] : enabledNow.filter((c) => c !== l.code))}
                />
                {#if l.code === 'en'}<input type="hidden" name="enabled" value="en" />{/if}
              </td>
              <td>
                <input type="radio" name="default" value={l.code} checked={data.languages.default === l.code} disabled={!on} aria-label={t('{name} by default', { name: l.name })} />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="meta">{t('English is the base of every app and stays on. Each browser can pick its own language in the profile menu.')}</p>
      <div class="actions"><button class="btn btn-primary">{t('Save')}</button></div>
    </form>
    {#if data.languages.missing.length}
      <div class="card missing">
        <Mascot mood="tired" size={40} decorative />
        <div class="what">
          <strong>{t.n(data.languages.missing.length, 'One app is not translated yet', '{n} apps are not translated yet')}</strong>
          <span class="meta">
            {data.languages.missing.map((m) => `${m.name}: ${m.langs.map((c) => languageNames.get(c) ?? c).join(', ')}`).join(' · ')}
          </span>
        </div>
        <button type="button" class="btn btn-primary" onclick={() => askAgent(translateAsk(missingApps))}>{t('Ask the AI to translate')}</button>
      </div>
    {/if}
  </section>

  <section aria-labelledby="term-h">
    <div class="sh">
      <h2 id="term-h">{t('Terminal')}</h2>
      <button type="button" class="meta linkish" onclick={openDock}>{t('Open the terminal')}</button>
    </div>
    {#if !data.terminal.configured}
      <p class="muted">{t('The terminal is off. Set SIDECAR_TICKET_SECRET in .env and run docker compose up -d.')}</p>
    {:else}
      <ul class="menu card">
        {#each TOOLS as tool (tool.id)}
          {@const term = data.terminal}
          {@const ok = term[tool.id]}
          <li class="row">
            <span class="mark" style="--hue: {tool.hue}" aria-hidden="true">{tool.mark}</span>
            <span class="what">
              <strong>{tool.name}</strong>
              <span class="meta">
                {#if !term.reachable}{t('The terminal container is not answering.')}
                {:else if !ok}{tool.hint}
                {:else if tool.id === 'gh'}{t('Lets the tools push to and read your GitHub repositories.')}
                {:else}{t('Runs in the terminal: type {cmd}, or let Update, Build it and Install start it.', { cmd: tool.id })}{/if}
              </span>
            </span>
            <span class="state"><span class="status small" class:good={ok}>{ok ? t('Signed in') : t('Not signed in')}</span></span>
            {#if !ok && term.reachable}
              <button type="button" class="btn btn-primary" onclick={() => runInDock(tool.cmd)} title={t('Runs {cmd} in the terminal at the bottom', { cmd: tool.cmd })}>{t('Sign in')}</button>
            {/if}
          </li>
        {/each}
      </ul>
      <form method="POST" action="?/defaultAgent" class="mode agent" aria-label={t('Default AI')}
        use:enhance={() => async ({ update }) => (await update({ reset: false }), refreshDock())}>
        <span class="meta">{t('Default AI, for Update, Build it and Install:')}</span>
        {#each ['claude', 'codex'] as const as a (a)}
          <label><input type="radio" name="agent" value={a} checked={data.defaultAgent === a} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {AGENT_NAMES[a]}</label>
        {/each}
        <noscript><button class="btn">{t('Save')}</button></noscript>
      </form>
    {/if}
  </section>

  <section aria-labelledby="sys-h">
    <h2 id="sys-h">{t('System')}</h2>
    <ul class="menu card">
      <li>
        <a href="/settings/logs">
          <span class="mark" style="--hue: var(--hue-blue)" aria-hidden="true">≡</span>
          <span class="what"><strong>{t('Logs')}</strong><span class="meta">{t('Every log of the app in one place: web, updater, migrations, services')}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
      <li>
        <a href="/settings/worker">
          <span class="mark" style="--hue: var(--hue-green)" aria-hidden="true">⚙</span>
          <span class="what"><strong>{t('Worker')}</strong><span class="meta">{t("Your apps' background work: services, scheduled runs, and what they can reach")}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
      <li>
        <a href="/settings/connector">
          <span class="mark" style="--hue: var(--brand)" aria-hidden="true">✳</span>
          <span class="what"><strong>{t('Claude connector')}</strong><span class="meta">{t('Use your apps from claude.ai and the Claude apps (MCP)')}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
      <li>
        <a href="/settings/browser">
          <span class="mark" style="--hue: var(--hue-aqua)" aria-hidden="true">◎</span>
          <span class="what"><strong>{t('Browser')}</strong><span class="meta">{t('A remote browser for sign-ins that need one')}</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    </ul>
  </section>

  <section aria-labelledby="bk-h">
    <h2 id="bk-h">{t('Backups')}</h2>
    <div class="card backup">
      {#if data.backup}
        {@const b = data.backup}
        <span class="what">
          <strong>
            <span class="status small {b.status === 'running' ? 'warning' : b.status === 'failed' || b.stale ? 'critical' : 'good'}">
              {b.status === 'running' ? t('Backing up') : b.status === 'failed' ? t('Last backup failed') : b.stale ? t('Out of date') : t('Up to date')}
            </span>
          </strong>
          <span class="meta">
            {b.lastOk ? t('Last good backup {when} · {n} kept · daily at {hour}:00', { when: new Date(b.lastOk).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), n: b.count, hour: b.hour }) : t('No good backup yet.')}
            {#if b.status === 'failed'}<br />{b.message}{/if}
          </span>
          <span class="meta">{t('Database, .env and the installed extensions, in BACKUP_DIR next to the checkout. Copy that folder off this machine too (Hyper Backup, Time Machine). Restore: sudo ./beni.sh restore <folder>.')}</span>
        </span>
      {:else}
        <span class="what"><strong>{t('No backup status yet')}</strong><span class="meta">{t('The backup service writes it after its first run.')}</span></span>
      {/if}
      <form method="POST" action="?/backup" use:enhance><button class="btn">{t('Back up now')}</button></form>
    </div>
  </section>

  <section aria-labelledby="up-h">
    <h2 id="up-h">{t('Updates')}</h2>
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
      <div class="card updates">
        <div class="upstate">
          <span class="dot {state}" class:pulse={state === 'updating' || v.pending} aria-hidden="true"></span>
          <strong>{v.unanswered ? t('Waiting for the updater') : v.pending && state !== 'updating' ? t('Starting the update…') : title}</strong>
          {#if state === 'updating' || state === 'interrupted'}
            {#if state === 'interrupted'}
              <form method="POST" action="?/updateNow" use:enhance class="now">
                <button class="btn btn-primary" disabled={v.pending}>{v.pending ? t('Resuming…') : t('Resume')}</button>
              </form>
            {/if}
            <form method="POST" action="?/updateCancel" use:enhance class:now={state === 'updating'}>
              <button class="btn" disabled={cancelling} title={t('Stops the update; the containers that run now keep running')}>
                {cancelling ? t('Cancelling…') : t('Cancel')}
              </button>
            </form>
          {:else if state !== 'stale' && (state !== 'ok' || !latestSha || v.pending)}
            <!-- Up to date with GitHub as of now: nothing to click. Unknown (GitHub did not answer): Update asks the updater. -->
            <form method="POST" action="?/updateNow" use:enhance class="now">
              <button class="btn" class:btn-primary={state === 'available' || state === 'failed'} disabled={v.pending}>
                {v.pending ? t('Requested…') : state === 'failed' ? t('Try again') : t('Update')}
              </button>
            </form>
          {/if}
        </div>
        {#if v.unanswered}
          <p class="meta bad">
            {t('Requested {when}, but the updater has not taken it: is its scheduled task running every minute, all day? (In DSM its last run time must be 23:59.)', { when: when(data.updateControl.request) })}
            {t('On the host,')} <code>sudo ./beni.sh update</code> {t('updates right away.')}
          </p>
        {:else if v.pending}
          <p class="meta">{t('Requested {when}: the updater takes it within a minute.', { when: when(data.updateControl.request) })}</p>
        {/if}
        {#if state === 'stale'}
          <p class="meta">
            {t('No sign of it since {when}, so new commits on {branch} are not deployed.', { when: when(u.checkedAt || u.at), branch: u.branch })}
            {t('Its scheduled task must run')} <code>sh &lt;folder&gt;-updater/update.sh</code>
            {t('as root every minute, all day (DSM Task Scheduler: daily, every minute, first run 00:00, last run time 23:59);')}
            <code>sudo ./beni.sh doctor</code> {t('checks it, and')}
            <code>sudo ./beni.sh auto-update install</code> {t('prints the exact command.')} <code>sudo ./beni.sh update</code> {t('updates by hand.')}
          </p>
        {:else if state === 'updating' || state === 'interrupted'}
          <div class="progress" class:halted={state === 'interrupted'} role="progressbar" aria-valuemin="0" aria-valuemax={u.steps || 1} aria-valuenow={u.step} aria-label={t('Update progress')}>
            <span style="width: {u.steps ? Math.max(4, ((u.step - 0.5) / u.steps) * 100) : 4}%" class:indeterminate={!u.steps && state === 'updating'}></span>
          </div>
          <p class="meta">
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
            <pre class="tail" aria-label={t('Build output')}>{data.buildTail.join('\n')}</pre>
          {/if}
        {:else if u.status !== 'ok'}
          <p class="meta">{u.message}</p>
          {#if state === 'failed' && data.buildTail.length}
            <details>
              <summary>{t('Build output')}</summary>
              <pre class="tail">{data.buildTail.join('\n')}</pre>
            </details>
          {/if}
        {/if}
        {#if u.pendingRestart && state !== 'updating'}
          <div class="restart">
            <p class="meta">
              <strong>{u.pendingRestart.split(' ').join(` ${t('and')} `)}</strong>
              {v.restartPending
                ? t('still run the previous version. Restarting them ends the Claude and Codex sessions and the terminal running there.')
                : t('still run the previous version. Restarting them ends the Claude and Codex sessions and the terminal running there, so it waits for you.')}
            </p>
            <form method="POST" action="?/updateRestart" use:enhance>
              <button class="btn btn-primary" disabled={v.restartPending}>{v.restartPending ? t('Restarting…') : t('Restart now')}</button>
            </form>
          </div>
        {/if}
        <dl class="facts">
          {#if u.deployedSha}<dt>{t('Running')}</dt><dd><code>{short(u.deployedSha)}</code>{u.deployedAt ? `, ${t('deployed {when}', { when: when(u.deployedAt) })}` : ''}</dd>{/if}
          <dt>{t('Last change')}</dt><dd>{u.message}{u.at ? ` · ${when(u.at)}` : ''}</dd>
          <dt>GitHub {u.branch}</dt><dd>{#if latestSha}<code>{short(latestSha)}</code>, {t('checked as this page opened')}{:else}{t('not reachable from the app')}{/if}</dd>
          <dt>{t('Last check')}</dt><dd>{u.checkedAt ? when(u.checkedAt) : t('not reported')}</dd>
          {#if u.actions && state !== 'updating'}<dt>{t('Last actions')}</dt><dd><code>{u.actions}</code></dd>{/if}
        </dl>
        <form method="POST" action="?/updateMode" use:enhance class="mode" aria-label={t('Update mode')}>
          <label><input type="radio" name="mode" value="auto" checked={data.updateControl.mode === 'auto'} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {t('Automatic')}</label>
          <label><input type="radio" name="mode" value="manual" checked={data.updateControl.mode === 'manual'} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {t('Manual: show new versions, update when I click')}</label>
          <noscript><button class="btn">{t('Save')}</button></noscript>
        </form>
        <form method="POST" action="?/updateRestarts" use:enhance class="mode" aria-label={t('Restarts of the terminal')}>
          <label><input type="radio" name="restarts" value="ask" checked={data.updateControl.restarts !== 'auto'} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {t('Ask before restarting the terminal (it ends what runs in it)')}</label>
          <label><input type="radio" name="restarts" value="auto" checked={data.updateControl.restarts === 'auto'} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> {t('Restart it by itself')}</label>
          <noscript><button class="btn">{t('Save')}</button></noscript>
        </form>
        <p class="meta">
          {t('The host\'s updater runs every minute, checks {branch} on GitHub every few minutes and rebuilds only what changed.', { branch: u.branch })}
          {t('On the host the same update is')} <code>sudo ./beni.sh update</code>.
          <a href="/settings/logs?file=updater.log">{t('Updater log')}</a>
        </p>
      </div>
    {:else}
      <p class="muted">
        {t('The updater is not set up. On the host,')} <code>sudo ./beni.sh update</code>
        {t('sets it up and updates; it prints the scheduled task to add (spec 006).')}
      </p>
    {/if}
  </section>

  <section aria-labelledby="sec-h">
    <h2 id="sec-h">{t('Security')}</h2>
    <div class="card security">
      <p class="meta">{t('One app password opens the whole assistant. Settings ask for it again and lock after 10 minutes.')}</p>
      {#if data.passwordFromEnv}
        <p class="muted">{t('Set in .env (APP_PASSWORD_HASH). Remove that line and restart web to manage it here.')}</p>
      {:else}
        <details>
          <summary>{t('Change the app password')}</summary>
          <form method="POST" action="?/password" class="row" use:enhance>
            <label class="field"><span>{t('New password (12+)')}</span><input name="password" type="password" autocomplete="new-password" minlength="12" required /></label>
            <label class="field"><span>{t('Repeat')}</span><input name="repeat" type="password" autocomplete="new-password" minlength="12" required /></label>
            <div class="actions"><button class="btn btn-primary">{t('Change')}</button></div>
          </form>
          <p class="meta">{t('Every other device is logged out.')}</p>
        </details>
      {/if}
    </div>
  </section>
{/if}

<style>
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
  .lede {
    color: var(--ink-2);
  }
  section {
    margin-bottom: var(--space-6);
  }
  h2 {
    font-size: 1.0625rem;
    margin: 0 0 var(--space-2);
  }
  .sh {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .sh a {
    color: var(--accent-ink);
    font-weight: 600;
  }

  /* Quick actions */
  .quick {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }
  .do {
    display: grid;
    justify-items: start;
    text-align: left;
    font: inherit;
    cursor: pointer;
    gap: 2px;
    padding: var(--space-4);
    color: var(--ink);
    text-decoration: none;
    transition:
      border-color 120ms,
      transform 120ms;
  }
  .do:hover {
    border-color: var(--hue);
    transform: translateY(-1px);
  }
  .ico {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: var(--space-2);
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
  }
  .ico svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Lists */
  .menu {
    list-style: none;
    margin: 0;
    padding: var(--space-1) var(--space-4);
  }
  .menu li + li {
    border-top: 1px solid var(--ring);
  }
  .menu a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    color: inherit;
    text-decoration: none;
  }
  .menu li.row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .menu li.row .btn {
    flex: none;
  }
  .linkish {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent-ink);
    cursor: pointer;
    font: inherit;
  }
  .menu a:hover strong {
    color: var(--accent-ink);
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 0.8125rem/1 var(--mono);
  }
  .mark.plus,
  .avatar.plus {
    background: none;
    border: 1.5px dashed var(--ring);
    color: var(--ink-2);
    font-size: 1.1rem;
  }
  .add strong {
    color: var(--accent-ink);
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .what .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    flex: none;
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .chev {
    color: var(--ink-3);
    font-size: 1.25rem;
  }
  .meta,
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  @media (max-width: 560px) {
    .state {
      display: none;
    }
  }

  /* Profiles */
  .people {
    display: grid;
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
    padding: var(--space-4);
  }
  .people:hover {
    border-color: var(--accent);
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
  .pname {
    font-size: 0.8125rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Updates, security */
  .updates,
  .security {
    display: grid;
    gap: var(--space-2);
  }
  .updates p,
  .security p {
    margin: 0;
  }
  .upstate {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--good);
  }
  .dot.failed {
    background: var(--critical);
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
  .restart {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .restart p {
    flex: 1;
  }
  .progress.halted span {
    background: var(--warning);
  }
  .meta.bad {
    color: var(--critical-ink);
  }
  .tail {
    margin: 0;
    max-height: 13em;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: #141413;
    color: #c9c7bf;
    font: 0.75rem/1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
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
  .upstate .now {
    margin: 0 0 0 auto;
  }
  .mode {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    font-size: 0.875rem;
  }
  .mode.agent {
    align-items: center;
    margin-top: var(--space-3);
  }
  .mode label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .dot.available {
    background: var(--accent);
  }
  .dot.blocked,
  .dot.updating,
  .dot.interrupted {
    background: var(--warning);
  }
  .dot.stale {
    background: var(--critical);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px var(--space-3);
    margin: 0;
    font-size: 0.8125rem;
  }
  .facts dt {
    color: var(--ink-2);
  }
  .facts dd {
    margin: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dot.pulse {
      animation: pulse 1s ease-in-out infinite;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
  }
  details[open] summary {
    margin-bottom: var(--space-3);
  }
  details .meta {
    margin-top: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .field input {
    min-width: 0;
  }
  .actions {
    margin-left: auto;
  }
  .unlock {
    display: grid;
    gap: var(--space-3);
    max-width: 420px;
  }
  .unlock h2,
  .unlock p {
    margin: 0;
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
  code {
    font-size: 0.8125rem;
  }

  /* Language */
  .langs {
    display: grid;
    gap: var(--space-3);
  }
  .langs p {
    margin: 0;
  }
  .langs table {
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .langs th,
  .langs td {
    padding: 6px var(--space-3) 6px 0;
    text-align: left;
  }
  .langs thead th {
    color: var(--ink-2);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .langs tbody th {
    font-weight: 500;
  }
  .langs tbody tr + tr {
    border-top: 1px solid var(--ring);
  }
  .missing {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--warning);
  }
  .missing .btn {
    flex: none;
  }
  .missing .meta {
    white-space: normal;
  }
  @media (max-width: 560px) {
    .missing {
      flex-wrap: wrap;
    }
  }
  .backup {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .backup .what {
    display: grid;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
</style>
