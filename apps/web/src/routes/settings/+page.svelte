<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import Mascot from '#lib/Mascot.svelte';
  import { hueFor, initials } from '#lib/settings/guide.ts';

  let { data, form } = $props();

  const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');
  const short = (sha: string) => sha.slice(0, 7);
  const next = $derived(page.url.searchParams.get('next') ?? '');

  const whoSees = (ids: string[] | null, profiles: { id: string; name: string }[]) =>
    ids === null ? 'everyone' : ids.map((id) => profiles.find((p) => p.id === id)?.name ?? id).join(', ') || 'nobody';
</script>

<svelte:head><title>System settings · Assistant</title></svelte:head>

<div class="hero">
  <Mascot mood={data.locked ? 'asleep' : 'steady'} size={64} decorative />
  <div class="title">
    <h1>System settings</h1>
    <p class="lede">Apps, people, the terminal and security, all in one place.</p>
  </div>
  {#if !data.locked}
    <form method="POST" action="?/lock" use:enhance>
      <button class="btn">Lock</button>
    </form>
  {/if}
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

{#if !data.locked && page.url.searchParams.has('welcome')}
  <p class="note good">All set. Add apps and the other people at home here; everything else lives on the dashboard.</p>
{/if}

{#if data.locked}
  <form method="POST" action={next ? `?/unlock&next=${encodeURIComponent(next)}` : '?/unlock'} class="card unlock">
    <h2>Enter the app password again</h2>
    <p class="muted">Settings change what everybody sees, so they ask for the password again. They stay open for 10 minutes.</p>
    <label>
      <span class="sr">App password</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" name="password" autocomplete="current-password" required autofocus />
    </label>
    <button class="btn btn-primary">Unlock</button>
  </form>
{:else}
  <nav class="quick" aria-label="Common tasks">
    <a class="card do" href="/settings/extensions/new" style="--hue: var(--hue-orange)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span>
      <strong>Extend the system</strong>
      <span class="meta">Install an app or let AI build one</span>
    </a>
    <a class="card do" href="/settings/profiles#add" style="--hue: var(--hue-blue)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="8" cy="7" r="3" /><path d="M2.5 16c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15 6v6M12 9h6" /></svg></span>
      <strong>Add a person</strong>
      <span class="meta">A profile with their own data</span>
    </a>
    <a class="card do" href="/settings/terminal" style="--hue: var(--hue-violet)">
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 6l4 4-4 4M10 14h6" /></svg></span>
      <strong>Open the terminal</strong>
      <span class="meta">Claude Code, Codex, a shell</span>
    </a>
  </nav>

  <section aria-labelledby="apps-h">
    <div class="sh">
      <h2 id="apps-h">Apps</h2>
      <span class="meta">{data.extensions.length} installed</span>
    </div>
    <ul class="menu card">
      {#each data.extensions as ext (ext.id)}
        <li>
          <a href="/settings/extensions/{ext.id}">
            <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
            <span class="what">
              <strong>{ext.name}</strong>
              <span class="meta">{ext.description || (ext.kind === 'native' ? 'Native app' : 'One-file app')}</span>
            </span>
            <span class="state">
              <span class="status small" class:good={ext.enabled}>{ext.enabled ? `On · ${whoSees(ext.profiles, data.profiles)}` : 'Off'}</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </a>
        </li>
      {:else}
        <li class="none">
          <Mascot mood="idle" size={48} decorative />
          <span class="muted">No apps yet. Install a ready-made one or let Claude build one for you.</span>
        </li>
      {/each}
      <li>
        <a href="/settings/extensions/new" class="add">
          <span class="mark plus" aria-hidden="true">+</span>
          <span class="what"><strong>Extend the system</strong><span class="meta">Ready-made apps, inspirations, or your own idea</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    </ul>
  </section>

  <section aria-labelledby="people-h">
    <div class="sh">
      <h2 id="people-h">Profiles</h2>
      <a class="meta" href="/settings/profiles">Manage</a>
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
          <span class="pname">Add</span>
        </span>
      </span>
      <span class="meta">Everyone gets their own data and dashboard. Not accounts: the app password opens all.</span>
    </a>
  </section>

  <section aria-labelledby="sys-h">
    <h2 id="sys-h">System</h2>
    <ul class="menu card">
      <li>
        <a href="/settings/terminal">
          <span class="mark" style="--hue: var(--hue-violet)" aria-hidden="true">›_</span>
          <span class="what"><strong>Terminal</strong><span class="meta">Sign in to Claude, Codex and GitHub, and build apps</span></span>
          <span class="state">
            {#if !data.terminal.configured}<span class="status small warning">Off</span>
            {:else if !data.terminal.reachable}<span class="status small critical">Not answering</span>
            {:else}<span class="status small" class:good={data.terminal.claude}>{data.terminal.claude ? 'Claude signed in' : 'Claude not signed in'}</span>{/if}
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
      <li>
        <a href="/settings/browser">
          <span class="mark" style="--hue: var(--hue-aqua)" aria-hidden="true">◎</span>
          <span class="what"><strong>Browser</strong><span class="meta">A remote browser for sign-ins that need one</span></span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      </li>
    </ul>
  </section>

  <section aria-labelledby="up-h">
    <h2 id="up-h">Updates</h2>
    {#if data.updates}
      {@const u = data.updates}
      <div class="card updates">
        <p class="upstate">
          <span class="dot {u.status}" aria-hidden="true"></span>
          <strong>{u.status === 'ok' ? 'Up to date' : u.status === 'failed' ? 'Last update failed' : 'Updates paused'}</strong>
          {#if u.deployedSha}<code>{short(u.deployedSha)}</code>{/if}
        </p>
        <p class="meta">
          {u.message}{u.at ? ` · ${when(u.at)}` : ''}
          {#if u.status !== 'ok' && u.deployedSha}<br />Running {short(u.deployedSha)}{u.deployedAt ? `, deployed ${when(u.deployedAt)}` : ''}.{/if}
        </p>
        {#if u.actions}<p class="meta">Last actions: <code>{u.actions}</code></p>{/if}
        <p class="meta">The NAS pulls {u.branch} from GitHub every 5 minutes and rebuilds only what changed. Log: <code>/logs/updater.log</code>.</p>
      </div>
    {:else}
      <p class="muted">
        Automatic updates are off. To turn them on, run <code>sudo sh scripts/auto-update.sh install</code> on the host
        (spec 006).
      </p>
    {/if}
  </section>

  <section aria-labelledby="sec-h">
    <h2 id="sec-h">Security</h2>
    <div class="card security">
      <p class="meta">One app password opens the whole assistant. Settings ask for it again and lock after 10 minutes.</p>
      {#if data.passwordFromEnv}
        <p class="muted">Set in <code>.env</code> (<code>APP_PASSWORD_HASH</code>). Remove that line and restart <code>web</code> to manage it here.</p>
      {:else}
        <details>
          <summary>Change the app password</summary>
          <form method="POST" action="?/password" class="row" use:enhance>
            <label class="field"><span>New password (12+)</span><input name="password" type="password" autocomplete="new-password" minlength="12" required /></label>
            <label class="field"><span>Repeat</span><input name="repeat" type="password" autocomplete="new-password" minlength="12" required /></label>
            <div class="actions"><button class="btn btn-primary">Change</button></div>
          </form>
          <p class="meta">Every other device is logged out.</p>
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
  .dot.blocked {
    background: var(--warning);
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
</style>
