<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import { buildChangePrompt, hueFor, initials, PENDING_PROMPT_KEY } from '$lib/settings/guide';
  let { data, form } = $props();
  let change = $state('');

  function askClaude() {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, buildChangePrompt(ext.id, ext.name, change));
    } catch {
      /* no storage */
    }
    goto('/settings/terminal#ready');
  }
  const ext = $derived(data.ext);
  const plain = $derived(ext.settings.filter((f) => f.type !== 'secret'));
  const slot = (name: string) => data.secrets.find((s) => s.name === name);
  const fieldsById = $derived(new Map(ext.settings.map((f) => [f.name, f])));
</script>

<svelte:head><title>{ext.name} · System settings</title></svelte:head>

<div class="head">
  <p class="eyebrow"><a href="/settings">System settings</a></p>
  <div class="name">
    <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
    <h1>{ext.name}</h1>
    <span class="status small" class:good={ext.enabled}>{ext.enabled ? 'On' : 'Off'}</span>
  </div>
  {#if ext.description}<p class="muted">{ext.description}</p>{/if}
  <p class="meta">
    {ext.kind === 'native' ? 'Native' : 'One file'} · {ext.scope === 'shared' ? 'data shared by all profiles' : 'data per profile'} ·
    v{ext.version}{#if ext.inspiredBy}
      · inspired by {#if /^https?:\/\//.test(ext.inspiredBy)}<a href={ext.inspiredBy} rel="noreferrer">{ext.inspiredBy.replace(/^https?:\/\//, '')}</a>{:else}{ext.inspiredBy}{/if}{/if}
  </p>
  <p><a class="btn-ghost" href={ext.href}>Open {ext.name}</a></p>
</div>

{#if form?.error}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok}<p class="note good" role="status">{form.ok}</p>{/if}

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

{#if ext.secrets.length}
  <section>
    <h2>Secrets</h2>
    <p class="muted">Stored encrypted. Nobody can read a value back here, only replace or remove it.</p>
    {#if !data.secretsAvailable}
      <p class="note bad">Set <code>SECRETS_KEY</code> in <code>.env</code> first: it encrypts these values.</p>
    {/if}
    <div class="stack">
      {#each ext.secrets as name (name)}
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

{#if !plain.length && !ext.secrets.length && !ext.settingsPage}
  <p class="muted">{ext.name} has no settings of its own.</p>
{/if}

<section>
  <h2>Change {ext.name}</h2>
  <div class="card ask">
    <Mascot mood="steady" size={48} decorative />
    <form class="stack" onsubmit={(e) => { e.preventDefault(); askClaude(); }}>
      <label class="field wide">
        <span>Missing something? Describe it and Claude changes the app for you in the terminal.</span>
        <input bind:value={change} placeholder="e.g. add a weekly summary tile to the dashboard" required minlength="4" />
      </label>
      <div class="actions"><button class="btn btn-primary" disabled={change.trim().length < 4}>Ask Claude</button></div>
    </form>
  </div>
</section>

<style>
  .head {
    display: grid;
    gap: var(--space-1);
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
  .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 0.9375rem/1 var(--mono);
  }
  .ask {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .ask form {
    flex: 1;
    min-width: 0;
  }
  .field.wide {
    max-width: none;
  }
  .meta,
  .small {
    font-size: 0.8125rem;
    color: var(--ink-2);
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
