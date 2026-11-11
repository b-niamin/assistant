<script lang="ts">
  import { enhance } from '$app/forms';
  import { AGENT_NAMES, draftForAgent, pickAgent } from '#lib/dock/dock.svelte.ts';
  import SourcesPanel from '#lib/settings/SourcesPanel.svelte';
  import { claimedFields } from '#lib/extensions/sources.ts';
  import { hueFor, initials } from '#lib/settings/guide.ts';
  import { languageInfo, tFor, useT } from '#lib/i18n/index.ts';
  let { data, form } = $props();
  const t = useT();
  /** The extension's own texts (select options), from its i18n/<lang>.json. */
  const tExt = $derived(tFor(t.lang, data.ext.id));
  const ext = $derived(data.ext);
  // Fields a connected account edits in its own card stay out of the generic sections below.
  const claimed = $derived(data.sources?.ok ? claimedFields(data.sources.sources) : new Set<string>());
  const plain = $derived(ext.settings.filter((f) => f.type !== 'secret' && !claimed.has(f.name)));
  const secretNames = $derived(ext.secrets.filter((n) => !claimed.has(n)));
  const slot = (name: string) => data.secrets.find((s) => s.name === name);
  const fieldsById = $derived(new Map(ext.settings.map((f) => [f.name, f])));
  const agentName = $derived(AGENT_NAMES[pickAgent()]);
</script>

<svelte:head><title>{ext.name} · {t('System settings')}</title></svelte:head>

<header class="head">
  <p class="eyebrow"><a href="/settings">{t('System settings')}</a></p>
  <div class="ident">
    <span class="mark" style="--hue: {hueFor(ext.id)}" aria-hidden="true">{initials(ext.name)}</span>
    <div class="title">
      <div class="name">
        <h1>{ext.name}</h1>
        <span class="status small" class:good={ext.enabled}>{ext.enabled ? t('On') : t('Off')}</span>
      </div>
      {#if ext.description}<p class="desc">{ext.description}</p>{/if}
    </div>
    <a class="btn open" href={ext.href}>{t('Open')}</a>
  </div>
  <ul class="meta" aria-label={t('About {name}', { name: ext.name })}>
    <li>{ext.kind === 'native' ? t('Native') : t('One file')}</li>
    <li>{ext.scope === 'shared' ? t('Data shared by all profiles') : t('Data per profile')}</li>
    <li class="num">v{ext.version}</li>
    <li>{ext.languages.map((c) => languageInfo(c).name).join(', ')}</li>
    {#if ext.inspiredBy}
      <li>
        {t('Inspired by')} {#if /^https?:\/\//.test(ext.inspiredBy)}<a href={ext.inspiredBy} rel="noreferrer">{ext.inspiredBy.replace(/^https?:\/\//, '')}</a>{:else}{ext.inspiredBy}{/if}
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
    items={data.secretItems}
    secretsAvailable={data.secretsAvailable}
  />
{/if}

<p class="card change">
  <span class="meta">{t('To change {name}, click Update: {agent} opens in the terminal at the bottom with the request started, for you to finish.', { name: ext.name, agent: agentName })}</span>
  <button type="button" class="btn" onclick={() => draftForAgent(`Update extension ${ext.name} (extensions/${ext.id}): `)}>{t('Update')}</button>
</p>

{#if form?.error && !form.source}<p class="note bad" role="alert">{form.error}</p>{/if}
{#if form?.ok && !form.source}<p class="note good" role="status">{form.ok}</p>{/if}

<section>
  <h2>{t('Availability')}</h2>
  <form method="POST" action="?/switches" class="card stack" use:enhance>
    <label class="check"><input type="checkbox" name="enabled" checked={ext.enabled} /> {t('On')} <span class="muted">{t('(off hides it everywhere; its data stays)')}</span></label>
    <fieldset>
      <legend>{t('Who sees it')}</legend>
      <label class="check"><input type="checkbox" name="everyone" checked={ext.profiles === null} /> {t('Everyone')}</label>
      {#each data.profiles as p (p.id)}
        <label class="check"><input type="checkbox" name="profiles" value={p.id} checked={ext.profiles?.includes(p.id) ?? false} /> {p.name}</label>
      {/each}
    </fieldset>
    <div class="actions"><button class="btn">{t('Save')}</button></div>
  </form>
</section>

{#if plain.length}
  <section>
    <h2>{t('Settings')}</h2>
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
                {#each f.options ?? [] as o (o)}<option value={o} selected={v === o}>{tExt(o)}</option>{/each}
              </select>
            {:else}
              <input name="field:{f.name}" inputmode={f.type === 'number' ? 'decimal' : undefined} value={v ?? ''} />
            {/if}
          </label>
        {/if}
        {#if f.help}<p class="help muted">{f.help}</p>{/if}
      {/each}
      <div class="actions"><button class="btn">{t('Save settings')}</button></div>
    </form>
  </section>
{/if}

{#if secretNames.length}
  <section>
    <h2>{t('Secrets')}</h2>
    <p class="muted">{t('Stored encrypted. Nobody can read a value back here, only replace or remove it.')}</p>
    {#if !data.secretsAvailable}
      <p class="note bad">{t('Set SECRETS_KEY in .env first: it encrypts these values.')}</p>
    {/if}
    <div class="stack">
      {#each secretNames as name (name)}
        {@const s = slot(name)}
        <div class="card secret">
          <div class="what">
            <strong>{fieldsById.get(name)?.label ?? name}</strong>
            <span class="muted small">{#if s?.updatedAt}{t('set')}{s.keyHint ? `, ${t('ends in …{hint}', { hint: s.keyHint })}` : ''}{:else}{t('not set')}{/if}</span>
            {#if fieldsById.get(name)?.help}<span class="muted small">{fieldsById.get(name)?.help}</span>{/if}
          </div>
          <form method="POST" action="?/secret" use:enhance class="set">
            <input type="hidden" name="name" value={name} />
            <label class="sr" for="s-{name}">{t('New value for {name}', { name })}</label>
            <input id="s-{name}" name="value" type="password" autocomplete="off" required
              placeholder={s?.updatedAt ? t('Replace value') : t('Value')} disabled={!data.secretsAvailable} />
            <button class="btn" disabled={!data.secretsAvailable}>{t('Save')}</button>
          </form>
          {#if s?.updatedAt}
            <form method="POST" action="?/secret" use:enhance>
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="remove" value="1" />
              <button class="btn-ghost">{t('Remove')}</button>
            </form>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if ext.settingsPage}
  <section>
    <h2>{t('More')}</h2>
    <p><a class="btn-ghost" href="{ext.href}/settings">{t('More {name} settings', { name: ext.name })}</a></p>
  </section>
{/if}

{#if !plain.length && !secretNames.length && !ext.settingsPage && !data.sources}
  <p class="muted">{t('{name} has no settings of its own.', { name: ext.name })}</p>
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
