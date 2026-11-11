<script lang="ts">
  import { enhance } from '$app/forms';
  import { AGENT_NAMES, askAgent, pickAgent } from '#lib/dock/dock.svelte.ts';
  import SourcesPanel from '#lib/settings/SourcesPanel.svelte';
  import { claimedFields } from '#lib/extensions/sources.ts';
  import { buildChangePrompt, hueFor, initials } from '#lib/settings/guide.ts';
  let { data, form } = $props();
  const ext = $derived(data.ext);
  // Fields a connected account edits in its own card stay out of the generic sections below.
  const claimed = $derived(data.sources?.ok ? claimedFields(data.sources.sources) : new Set<string>());
  const plain = $derived(ext.settings.filter((f) => f.type !== 'secret' && !claimed.has(f.name)));
  const secretNames = $derived(ext.secrets.filter((n) => !claimed.has(n)));
  const slot = (name: string) => data.secrets.find((s) => s.name === name);
  const fieldsById = $derived(new Map(ext.settings.map((f) => [f.name, f])));
  const agentName = $derived(AGENT_NAMES[pickAgent()]);
  // "Update": ask what should change, then start the default AI CLI with it in a new terminal window.
  let changing = $state(false);
  let change = $state('');
  function startChange(e: Event) {
    e.preventDefault();
    if (!change.trim()) return;
    askAgent(buildChangePrompt(ext.id, ext.name, change));
    change = '';
    changing = false;
  }
</script>

<svelte:head><title>{ext.name} · System settings</title></svelte:head>

<header class="head">
  <p class="eyebrow"><a href="/settings">System settings</a></p>
  <div class="ident">
    <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
    <div class="title">
      <div class="name">
        <h1>{ext.name}</h1>
        <span class="status small" class:good={ext.enabled}>{ext.enabled ? 'On' : 'Off'}</span>
      </div>
      {#if ext.description}<p class="desc">{ext.description}</p>{/if}
    </div>
    <a class="btn open" href={ext.href}>Open</a>
  </div>
  <ul class="meta" aria-label="About {ext.name}">
    <li>{ext.kind === 'native' ? 'Native' : 'One file'}</li>
    <li>{ext.scope === 'shared' ? 'Data shared by all profiles' : 'Data per profile'}</li>
    <li class="num">v{ext.version}</li>
    {#if ext.inspiredBy}
      <li>
        Inspired by {#if /^https?:\/\//.test(ext.inspiredBy)}<a href={ext.inspiredBy} rel="noreferrer">{ext.inspiredBy.replace(/^https?:\/\//, '')}</a>{:else}{ext.inspiredBy}{/if}
      </li>
    {/if}
  </ul>
</header>

{#if data.sources}
  <SourcesPanel
    extId={ext.id}
    result={data.sources}
    {form}
    settings={ext.settings}
    values={data.values}
    secrets={data.secrets}
    secretsAvailable={data.secretsAvailable}
  />
{/if}

{#if changing}
  <form class="card change" onsubmit={startChange}>
    <label class="ask">
      <span class="meta">What should change in {ext.name}? {agentName} starts in the terminal at the bottom with it.</span>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea name="change" rows="3" bind:value={change} autofocus required
        onkeydown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && startChange(e)} placeholder="e.g. add a rest timer"></textarea>
    </label>
    <div class="actions">
      <button type="button" class="btn-ghost" onclick={() => (changing = false)}>Cancel</button>
      <button class="btn btn-primary" disabled={!change.trim()}>Ask {agentName}</button>
    </div>
  </form>
{:else}
  <p class="card change">
    <span class="meta">To change {ext.name}, say what you want and {agentName} does it in the terminal at the bottom.</span>
    <button type="button" class="btn" onclick={() => (changing = true)}>Update</button>
  </p>
{/if}

{#if form?.error && !form.source}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok && !form.source}<p class="note good" role="status">{form.ok}</p>{/if}

<section>
  <h2>Availability</h2>
  <form method="POST" action="?/switches" class="card stack" use:enhance>
    <label class="check"><input type="checkbox" name="enabled" checked={ext.enabled} /> On <span class="muted">(off hides it everywhere; its data stays)</span></label>
    <fieldset>
      <legend>Who sees it</legend>
      <label class="check"><input type="checkbox" name="everyone" checked={ext.profiles === null} /> Everyone</label>
      {#each data.profiles as p (p.id)}
        <label class="check"><input type="checkbox" name="profiles" value={p.id} checked={ext.profiles?.includes(p.id) ?? false} /> {p.name}</label>
      {/each}
    </fieldset>
    <div class="actions"><button class="btn">Save</button></div>
  </form>
</section>

{#if plain.length}
  <section>
    <h2>Settings</h2>
    <form method="POST" action="?/fields" class="card stack" use:enhance>
      {#each plain as f (f.name)}
        {@const v = data.values[f.name]}
        {#if f.type === 'boolean'}
          <label class="check"><input type="checkbox" name="field:{f.name}" checked={v === true} /> {f.label}</label>
        {:else}
          <label class="field">
            <span>{f.label}</span>
            {#if f.type === 'select'}
              <select name="field:{f.name}">
                <option value="" selected={v === null}>—</option>
                {#each f.options ?? [] as o (o)}<option value={o} selected={v === o}>{o}</option>{/each}
              </select>
            {:else}
              <input name="field:{f.name}" inputmode={f.type === 'number' ? 'decimal' : undefined} value={v ?? ''} />
            {/if}
          </label>
        {/if}
        {#if f.help}<p class="help muted">{f.help}</p>{/if}
      {/each}
      <div class="actions"><button class="btn">Save settings</button></div>
    </form>
  </section>
{/if}

{#if secretNames.length}
  <section>
    <h2>Secrets</h2>
    <p class="muted">Stored encrypted. Nobody can read a value back here, only replace or remove it.</p>
    {#if !data.secretsAvailable}
      <p class="note bad">Set <code>SECRETS_KEY</code> in <code>.env</code> first: it encrypts these values.</p>
    {/if}
    <div class="stack">
      {#each secretNames as name (name)}
        {@const s = slot(name)}
        <div class="card secret">
          <div class="what">
            <strong>{fieldsById.get(name)?.label ?? name}</strong>
            <span class="muted small">{#if s?.updatedAt}set{s.keyHint ? `, ends in …${s.keyHint}` : ''}{:else}not set{/if}</span>
            {#if fieldsById.get(name)?.help}<span class="muted small">{fieldsById.get(name)?.help}</span>{/if}
          </div>
          <form method="POST" action="?/secret" use:enhance class="set">
            <input type="hidden" name="name" value={name} />
            <label class="sr" for="s-{name}">New value for {name}</label>
            <input id="s-{name}" name="value" type="password" autocomplete="off" required
              placeholder={s?.updatedAt ? 'Replace value' : 'Value'} disabled={!data.secretsAvailable} />
            <button class="btn" disabled={!data.secretsAvailable}>Save</button>
          </form>
          {#if s?.updatedAt}
            <form method="POST" action="?/secret" use:enhance>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="remove" value="1" />
              <button class="btn-ghost">Remove</button>
            </form>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if ext.settingsPage}
  <section>
    <h2>More</h2>
    <p><a class="btn-ghost" href="{ext.href}/settings">More {ext.name} settings</a></p>
  </section>
{/if}

{#if !plain.length && !secretNames.length && !ext.settingsPage && !data.sources}
  <p class="muted">{ext.name} has no settings of its own.</p>
{/if}

<style>
  .change {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0 0 var(--space-5);
    padding: var(--space-3) var(--space-4);
  }
  .ask {
    display: grid;
    gap: var(--space-2);
    flex: 1 1 100%;
  }
  .ask textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--ring);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  .change .actions {
    flex: 1 1 100%;
    gap: var(--space-2);
  }
  .head {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .head p,
  .head h1 {
    margin: 0;
  }
  .ident {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 1.125rem/1 var(--mono);
  }
  .title {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }
  .desc {
    color: var(--ink-2);
  }
  .open {
    flex: none;
    display: inline-flex;
    align-items: center;
    color: var(--ink);
    text-decoration: none;
    font-weight: 500;
  }
  .open:hover {
    background: var(--surface-2);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .meta li {
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  @media (max-width: 560px) {
    .ident {
      flex-wrap: wrap;
    }
    .mark {
      width: 44px;
      height: 44px;
      border-radius: 12px;
    }
    .open {
      order: 3;
      width: 100%;
      justify-content: center;
    }
  }
  section {
    margin-bottom: var(--space-5);
  }
  .stack {
    display: grid;
    gap: var(--space-2);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }
  legend {
    font-size: 0.8125rem;
    color: var(--ink-2);
    margin-bottom: var(--space-1);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: 0.8125rem;
    color: var(--ink-2);
    max-width: 420px;
  }
  .help {
    margin: -4px 0 0;
    font-size: 0.8125rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .secret {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .what {
    display: grid;
    gap: 2px;
    flex: 1 1 200px;
  }
  .set {
    display: flex;
    gap: var(--space-2);
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
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
