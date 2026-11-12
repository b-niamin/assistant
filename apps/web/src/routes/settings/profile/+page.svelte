<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { invalidateAll } from '$app/navigation';
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
  let copied = $state('');
  let adding = $state(false);
  let editing = $state('');

  const addressOf = (id: string) => (data.base ? `${data.base}/mcp/x/${id}` : '');
  const nameOf = (e: { builtin: boolean; name: string }) => (e.builtin ? t('All apps') : e.name);
  const appNames = (ids: string[] | null) =>
    ids ? ids.map((id) => data.apps.find((a) => a.id === id)?.name ?? id).join(', ') : t('every app, also ones installed later');
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : t('never');

  // A connection waiting for approval shows up within seconds of Connect in Claude: look again while the connector is on.
  $effect(() => {
    if (!data.connectorOn) return;
    const timer = setInterval(() => invalidateAll(), data.pending.length ? 3000 : 10000);
    return () => clearInterval(timer);
  });

  async function copy(id: string) {
    const url = addressOf(id);
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => null);
    copied = id;
    setTimeout(() => (copied = ''), 1500);
  }
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
  <p class="meta sub">{t('Remembered in this browser.')}</p>
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
        <span class="what"><strong id="lang-l">{t('Language')}</strong><span class="meta">{t('Which languages the app offers: System settings, Language.')}</span></span>
        <div class="seg" role="radiogroup" aria-labelledby="lang-l">
          {#each data.languages as l (l.code)}
            <button type="button" role="radio" lang={l.code} aria-checked={data.lang === l.code} class:on={data.lang === l.code} onclick={() => l.code !== data.lang && setLanguage(l.code)}>{l.name}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="pref">
      <span class="what"><strong id="motion-l">{t('Reduce motion')}</strong><span class="meta">{t('Beni and the charts keep still.')}</span></span>
      <button type="button" class="switch" role="switch" aria-checked={calm} aria-labelledby="motion-l" onclick={() => { calm = !calm; setMotionReduced(calm); }}><span></span></button>
    </div>
  </div>
</section>

<section class="sec" aria-labelledby="mcp-h">
  <h2 id="mcp-h">{t('Claude and MCP')}</h2>
  <p class="muted">
    {t('Each address below is a custom connector for Claude (claude.ai and the Claude apps). It shows the apps of this profile ticked for it, and changes data only where allowed.')}
  </p>
  {#if !data.connectorOn}
    <p class="note">{t('The Claude connector is off, so these addresses do not answer yet. Turn it on in System settings, Claude connector.')} <a href="/settings/connector">{t('Claude connector')}</a></p>
  {:else if !data.base}
    <p class="note">{t('The connector is turning on: the addresses appear once Tailscale Funnel is up.')}</p>
  {/if}

  <ul class="list">
    {#each data.endpoints as e (e.id)}
      <li class="card endpoint">
        <div class="row">
          <span class="what">
            <strong>{nameOf(e)}</strong>
            <span class="meta">{appNames(e.extensions)} · {e.canWrite ? t('read and write') : t('read only')}{e.builtin ? ` · ${t('built in')}` : ''}</span>
          </span>
          {#if !e.builtin}
            <button type="button" class="btn" aria-expanded={editing === e.id} onclick={() => (editing = editing === e.id ? '' : e.id)}>{t('Edit')}</button>
          {/if}
        </div>
        {#if addressOf(e.id)}
          <div class="url">
            <code>{addressOf(e.id)}</code>
            <button type="button" class="btn" onclick={() => copy(e.id)}>{copied === e.id ? t('Copied') : t('Copy')}</button>
          </div>
        {/if}
        {#if editing === e.id}
          <form class="edit" method="POST" action="?/update" use:enhance={() => async ({ update }) => { await update(); editing = ''; }}>
            <input type="hidden" name="id" value={e.id} />
            <label>{t('Name')}<input name="name" value={e.name} maxlength="60" required /></label>
            <fieldset>
              <legend>{t('Apps it shows')}</legend>
              {#each data.apps as a (a.id)}
                <label class="check"><input type="checkbox" name="apps" value={a.id} checked={e.extensions?.includes(a.id)} /> {a.name}</label>
              {/each}
            </fieldset>
            <label class="check"><input type="checkbox" name="write" checked={e.canWrite} /> {t('May change data (log workouts, save plans, add entries)')}</label>
            <div class="actions">
              <button class="btn" formaction="?/delete" formnovalidate>{t('Remove')}</button>
              <button class="btn btn-primary">{t('Save')}</button>
            </div>
          </form>
        {/if}
      </li>
    {/each}
  </ul>

  {#if adding}
    <form class="card edit" method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update(); adding = false; }}>
      <label>{t('Name')}<input name="name" maxlength="60" required placeholder={t('For example: Training')} /></label>
      <fieldset>
        <legend>{t('Apps it shows')}</legend>
        {#each data.apps as a (a.id)}
          <label class="check"><input type="checkbox" name="apps" value={a.id} /> {a.name}{#if a.shared} <span class="meta">({t('shared by everyone at home')})</span>{/if}</label>
        {/each}
      </fieldset>
      <label class="check"><input type="checkbox" name="write" /> {t('May change data (log workouts, save plans, add entries)')}</label>
      <div class="actions">
        <button type="button" class="btn" onclick={() => (adding = false)}>{t('Cancel')}</button>
        <button class="btn btn-primary">{t('Add address')}</button>
      </div>
    </form>
  {:else}
    <p><button type="button" class="btn" onclick={() => (adding = true)}>{t('Add an address')}</button></p>
  {/if}

  <ol class="steps">
    <li>{t('In claude.ai: Settings, Connectors, Add custom connector. Paste one address; no client ID or secret is needed.')}</li>
    <li>{t('Connect opens a page with a code. The same code shows up here, under Waiting for approval: pick the address and approve.')}</li>
    <li>{t('In a chat, turn the connector on in the tools menu. Claude reads the tool list when it connects: after installing an app, connect again.')}</li>
  </ol>
</section>

{#if data.pending.length}
  <section aria-labelledby="wait-h">
    <h2 id="wait-h">{t('Waiting for approval')}</h2>
    {#each data.pending as r (r.id)}
      <form class="card edit" method="POST" action="?/decide" use:enhance>
        <input type="hidden" name="id" value={r.id} />
        <p class="what">
          <strong>{r.client}</strong>
          <span class="meta">{t('Returns to {host} · asked {when}', { host: r.returnsTo, when: when(r.createdAt) })}</span>
        </p>
        <p class="code">{r.userCode}</p>
        <p class="meta">{t('Approve only if the page in Claude shows this same code.')}</p>
        <label>{t('Address')}
          <select name="endpoint">
            {#each data.endpoints as e (e.id)}<option value={e.id} selected={r.askedEndpoint === e.id}>{nameOf(e)}</option>{/each}
          </select>
        </label>
        <div class="actions">
          <button class="btn" name="decision" value="deny">{t('Deny')}</button>
          <button class="btn btn-primary" name="decision" value="allow">{t('Approve')}</button>
        </div>
      </form>
    {/each}
  </section>
{/if}

<section aria-labelledby="conn-h">
  <h2 id="conn-h">{t('Connections')}</h2>
  {#if data.connections.length}
    <ul class="menu card">
      {#each data.connections as c (c.id)}
        <li class="row">
          <span class="what">
            <strong>{c.client}</strong>
            <span class="meta">{t('Address {endpoint} · approved {approved} · last used {used} · ends {ends}', { endpoint: c.builtin ? t('All apps') : c.endpoint, approved: when(c.createdAt), used: when(c.lastUsedAt), ends: when(c.expiresAt) })}</span>
          </span>
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="id" value={c.id} />
            <button class="btn">{t('Remove')}</button>
          </form>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('No connections yet. Each Claude account or app that signs in shows up here, and can be removed.')}</p>
  {/if}
</section>

<section aria-labelledby="calls-h">
  <h2 id="calls-h">{t('Latest tool calls')}</h2>
  {#if data.calls.length}
    <ul class="calls card">
      {#each data.calls as c, i (i)}
        <li>
          <span class="status small {c.ok ? 'good' : 'critical'}">{c.ok ? t('ok') : t('failed')}</span>
          <code>{c.tool}</code>
          <span class="meta">{c.source === 'terminal' ? t('terminal') : c.client} · {when(c.at)}{c.error ? ` · ${c.error}` : ''}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('No tool calls yet.')}</p>
  {/if}
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
  .sub {
    margin: calc(-1 * var(--space-1)) 0 var(--space-3);
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
  section + section {
    margin-top: var(--space-5);
  }
  .list {
    list-style: none;
    margin: var(--space-3) 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .endpoint {
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-3);
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
    margin: 0;
  }
  .meta {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .bad {
    color: var(--critical-ink);
  }
  .url {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .url code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .edit {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    margin-top: var(--space-3);
  }
  .endpoint .edit {
    padding: 0;
    margin: 0;
  }
  .edit p {
    margin: 0;
  }
  .edit label {
    display: grid;
    gap: 4px;
  }
  .edit label.check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
  }
  .code {
    font: 600 1.5rem/1.2 ui-monospace, monospace;
    letter-spacing: 0.08em;
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
  }
  .steps {
    margin: var(--space-3) 0 0;
    padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + 1.25rem);
    border-radius: var(--radius);
    background: var(--surface-2);
    display: grid;
    gap: var(--space-2);
    color: var(--ink-2);
    max-width: 68ch;
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
  .calls {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  .calls li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
</style>
