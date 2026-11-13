<script lang="ts">
  import { enhance } from '#lib/forms.ts';
  import { onDestroy } from 'svelte';
  import { dock, runInDock } from '#lib/dock/dock.svelte.ts';
  import { busy, type SourceState, type SourceStatus, type SourcesResult } from '#lib/extensions/sources.ts';
  import type { SettingField } from '#lib/extensions/types.ts';
  import { hueFor } from './guide.ts';
  import { useT } from '#lib/i18n/index.ts';
  const t = useT();

  /**
   * Connected accounts of one extension (spec 002): each source with its state, the sync with a
   * progress bar while it runs (polled every few seconds), a few facts, the actions it offers and, for a
   * source that names settings `fields` (an address and a token), a form to connect it right here.
   */
  let {
    extId,
    result,
    form,
    settings = [],
    values = {},
    secrets = [],
    items = {},
    secretsAvailable = true
  }: {
    extId: string;
    result: SourcesResult;
    form?: { ok?: string; error?: string; source?: string } | null;
    settings?: SettingField[];
    values?: Record<string, string | number | boolean | null>;
    secrets?: { name: string; keyHint: string | null; updatedAt: Date | string | null }[];
    /** Each list secret's ("multiple") items, by hint only. */
    items?: Record<string, string[]>;
    secretsAvailable?: boolean;
  } = $props();

  /** The manifest fields a source edits in its card, in the source's order (text, number, secret only). */
  const fieldsOf = (s: SourceStatus) =>
    (s.fields ?? [])
      .map((n) => settings.find((f) => f.name === n))
      .filter((f): f is SettingField => !!f && (f.type === 'text' || f.type === 'number' || f.type === 'secret'));
  const slot = (name: string) => secrets.find((x) => x.name === name);

  let polled = $state<SourcesResult | null>(null);
  // A fresh page load (after an action) wins over an older poll.
  $effect(() => {
    void result;
    polled = null;
  });
  const current = $derived(polled ?? result);
  const list = $derived(current.ok ? current.sources : []);

  let timer: ReturnType<typeof setTimeout> | undefined;
  async function poll() {
    try {
      const res = await fetch(`/settings/extensions/${encodeURIComponent(extId)}/sources`, { cache: 'no-store' });
      if (res.ok) polled = (await res.json()) as SourcesResult;
      else if (res.status === 403) return; // the 10-minute unlock ran out: stop
    } catch {
      /* the app is restarting: try again */
    }
    schedule();
  }
  function schedule() {
    clearTimeout(timer);
    // Also for a few minutes after a sign-in was handed to the terminal, so "Connected" shows up by itself.
    if (busy(list) || (handed && Date.now() - handed.at < 5 * 60_000)) timer = setTimeout(poll, 3000);
  }
  $effect(() => {
    void list;
    schedule();
  });
  onDestroy(() => clearTimeout(timer));

  const STATE: Record<SourceState, { label: string; tone: string }> = $derived({
    connected: { label: t('Connected'), tone: 'good' },
    not_connected: { label: t('Not connected'), tone: '' },
    reconnect: { label: t('Sign in again'), tone: 'serious' },
    planned: { label: t('Coming later'), tone: '' }
  });

  const rtf = $derived(new Intl.RelativeTimeFormat(t.locale, { numeric: 'auto' }));
  function ago(isoTime: string): string {
    const s = (Date.parse(isoTime) - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 45) return s < 0 ? t('just now') : t('in a moment');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  // The command a source asks for runs in the dock's terminal; the button follows it there.
  let handed = $state<{ source: string; n: number; at: number } | null>(null);
  const handoffOf = (id: string) => (handed?.source === id && dock.handoff?.n === handed.n ? dock.handoff : null);
  /**
   * The command as the app's terminal runs it: extensions from before shell 4 name the host's
   * `docker compose exec -it worker ext-run ...`, and the terminal has `ext-run` but no Docker.
   */
  const inTerminal = (cmd: string) => cmd.replace(/^docker compose exec (?:-it |-i -t |-ti )?worker ext-run /, 'ext-run ');
  function runCommand(s: SourceStatus) {
    if (!s.command) return;
    handed = { source: s.id, n: runInDock(inTerminal(s.command)), at: Date.now() };
    schedule();
  }
</script>

<section aria-labelledby="sources-title">
  <h2 id="sources-title">{t('Connected accounts')}</h2>
  {#if !current.ok}
    <p class="muted">
      {current.reason === 'hidden'
        ? t('This extension is off or hidden from your profile, so its accounts are not shown.')
        : t('Could not read the accounts right now.')}
    </p>
  {:else if !list.length}
    <p class="muted">{t('No accounts yet.')}</p>
  {:else}
    <div class="sources">
      {#each list as s (s.id)}
        {@const st = STATE[s.state]}
        {@const own = fieldsOf(s)}
        {@const running = s.sync?.state === 'running' || s.sync?.state === 'queued'}
        <article class="card source" class:planned={s.state === 'planned'} aria-labelledby="src-{s.id}">
          <div class="top">
            <span class="mark" style="--hue: {hueFor(s.id)}" aria-hidden="true">{s.name.slice(0, 1)}</span>
            <div class="who">
              <h3 id="src-{s.id}">{s.name}</h3>
              {#if s.account}<span class="small">{s.account}</span>{/if}
            </div>
            <span class="status small {st.tone}">{st.label}</span>
          </div>

          {#if s.state !== 'connected' && (s.help || s.command)}
            <div class="connect">
              {#if s.help}<p class="small">{s.help}</p>{/if}
              {#if s.command}
                {@const h = handoffOf(s.id)}
                <div class="cmd">
                  <button type="button" class="btn btn-primary" onclick={() => runCommand(s)} disabled={h?.state === 'waiting'}>
                    {#if h?.state === 'waiting'}<span class="spin" aria-hidden="true"></span> {t('Opening the terminal…')}{:else}{t('Sign in in the terminal')}{/if}
                  </button>
                  <span class="small muted" role="status">
                    {#if h?.state === 'running'}{t('It runs in the terminal at the bottom: answer its questions there.')}{:else}<code>{inTerminal(s.command)}</code>{/if}
                  </span>
                </div>
              {/if}
            </div>
          {/if}

          {#if own.length}
            <form method="POST" action="?/connect" use:enhance class="fields">
              <input type="hidden" name="source" value={s.id} />
              {#each own as f (f.name)}
                {@const sl = f.type === 'secret' ? slot(f.name) : undefined}
                {#if f.multiple}
                  {@const list = items[f.name] ?? []}
                  <div class="field wide" role="group" aria-labelledby="lbl-{s.id}-{f.name}">
                    <span id="lbl-{s.id}-{f.name}">{f.label}</span>
                    {#if list.length}
                      <ul class="items">
                        {#each list as it, i (i)}
                          <li>
                            <span class="num">{it}</span>
                            <button class="x" form="rm-{s.id}-{f.name}" name="index" value={i} disabled={!secretsAvailable}
                              aria-label={t('Remove {item}', { item: it })} title={t('Remove')}>×</button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    <div class="add">
                      <input name="field:{f.name}" type="password" autocomplete="off" disabled={!secretsAvailable}
                        required={own.every((x) => x.multiple)} aria-label={t('Add to {label}', { label: f.label })} placeholder={t('Paste one and press +')} />
                      <button class="btn plus" disabled={!secretsAvailable} aria-label={t('Add')} title={t('Add')}>+</button>
                    </div>
                    {#if f.help}<span class="help">{f.help}</span>{/if}
                  </div>
                {:else}
                <label class="field wide">
                  <span>{f.label}{#if f.type === 'secret'} <span class="muted">({sl?.updatedAt ? `${t('set')}${sl.keyHint ? `, ${t('ends in …{hint}', { hint: sl.keyHint })}` : ''}; ${t('type to replace')}` : t('not set')})</span>{/if}</span>
                  {#if f.type === 'secret'}
                    <input name="field:{f.name}" type="password" autocomplete="off" disabled={!secretsAvailable}
                      placeholder={sl?.updatedAt ? t('Unchanged') : ''} required={!sl?.updatedAt} />
                  {:else}
                    <input name="field:{f.name}" inputmode={f.type === 'number' ? 'decimal' : undefined} value={values[f.name] ?? ''} />
                  {/if}
                  {#if f.help}<span class="help">{f.help}</span>{/if}
                </label>
                {/if}
              {/each}
              {#if own.some((f) => !f.multiple)}
                <div><button class="btn">{s.state === 'connected' ? t('Save') : t('Connect')}</button></div>
              {/if}
            </form>
            <!-- A list's [x] buttons belong to these forms, so Enter in the form above never removes an item. -->
            {#each own.filter((f) => f.multiple) as f (f.name)}
              <form id="rm-{s.id}-{f.name}" method="POST" action="?/connect" use:enhance hidden>
                <input type="hidden" name="source" value={s.id} />
                <input type="hidden" name="remove" value={f.name} />
              </form>
            {/each}
          {/if}

          {#if s.sync}
            <div class="sync" aria-live="polite">
              <div class="syncline">
                <span class="status small" class:good={s.sync.state === 'idle' && !s.sync.error} class:warning={running} class:critical={s.sync.state === 'failed'}>
                  {s.sync.state === 'running' ? t('Syncing') : s.sync.state === 'queued' ? t('Waiting to start') : s.sync.state === 'failed' ? t('Last sync failed') : t('Up to date')}
                </span>
                {#if s.sync.label}<span class="small label">{s.sync.label}</span>{/if}
                {#if running && s.sync.progress != null}<span class="small num pct">{pct(s.sync.progress)}</span>{/if}
              </div>
              {#if running}
                <div
                  class="bar"
                  class:indeterminate={s.sync.progress == null}
                  role="progressbar"
                  aria-label={t('{name} sync', { name: s.name })}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={s.sync.progress != null ? Math.round(s.sync.progress * 100) : undefined}
                >
                  <span style:width={s.sync.progress != null ? pct(s.sync.progress) : undefined}></span>
                </div>
              {/if}
              {#if s.sync.error}<p class="small err">{s.sync.error}</p>{/if}
              {#if s.sync.lastAt || s.sync.nextAt}
                <p class="small">
                  {#if s.sync.lastAt}{t('Last sync {when}', { when: ago(s.sync.lastAt) })}{/if}{#if s.sync.lastAt && s.sync.nextAt}&ensp;·&ensp;{/if}{#if s.sync.nextAt}{t('next {when}', { when: ago(s.sync.nextAt) })}{/if}
                </p>
              {/if}
            </div>
          {/if}

          {#if s.facts}
            <dl class="facts">
              {#each s.facts as f (f.label)}
                <div><dt>{f.label}</dt><dd class="num">{f.value}</dd></div>
              {/each}
            </dl>
          {/if}

          {#if form?.source === s.id && form.error}<p class="note bad" role="alert">{form.error}</p>{/if}
          {#if form?.source === s.id && form.ok}<p class="note good" role="status">{form.ok}</p>{/if}

          {#if s.actions}
            <div class="actions">
              {#each s.actions as a (a.id)}
                <form method="POST" action="?/source" use:enhance class="act" class:dated={!!a.date}>
                  <input type="hidden" name="source" value={s.id} />
                  <input type="hidden" name="action" value={a.id} />
                  {#if a.date}
                    <label class="field">
                      <span>{a.date.label}</span>
                      <input type="date" name="date" value={a.date.default ?? ''} min={a.date.min} max={a.date.max} required disabled={a.disabled} />
                    </label>
                  {/if}
                  <button class="btn" disabled={a.disabled}>{a.label}</button>
                  {#if a.help}<p class="small help">{a.help}</p>{/if}
                </form>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  section {
    margin-bottom: var(--space-5);
  }
  h2 {
    margin-bottom: var(--space-3);
  }
  .sources {
    display: grid;
    gap: var(--space-3);
  }
  .source {
    display: grid;
    gap: var(--space-4);
  }
  .source.planned {
    padding-block: var(--space-4);
    background: transparent;
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--hue) 16%, transparent);
    color: var(--hue);
    font: 700 0.9375rem/1 var(--mono);
  }
  .planned .mark {
    filter: grayscale(1);
    opacity: 0.6;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  h3 {
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
  }
  .small {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  p {
    margin: 0;
  }
  .connect {
    display: grid;
    gap: var(--space-2);
  }
  .linkish {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
  }
  .cmd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .cmd code {
    overflow-wrap: anywhere;
  }
  .cmd .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .sync {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--grid);
  }
  .syncline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .pct {
    font-weight: var(--weight-bold);
    color: var(--ink);
  }
  .err {
    color: var(--critical-ink);
  }
  .bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .bar.indeterminate span {
    width: 30%;
    animation: slide 1.4s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.indeterminate span {
      animation: none;
      width: 100%;
      opacity: 0.4;
    }
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: var(--space-3);
    margin: 0;
  }
  .facts div {
    display: grid;
    gap: 2px;
  }
  dt {
    font-size: var(--text-xs);
    color: var(--ink-3);
  }
  dd {
    margin: 0;
    font-weight: var(--weight-bold);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3) var(--space-5);
  }
  .act {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .act .help {
    flex-basis: 100%;
    max-width: 360px;
  }
  .field {
    display: grid;
    gap: 2px;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .fields {
    display: grid;
    gap: var(--space-3);
    max-width: 520px;
  }
  .field.wide {
    gap: 4px;
  }
  .field.wide input {
    width: 100%;
  }
  .items {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .items li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border: 1px solid var(--grid);
    border-radius: var(--radius-sm);
    color: var(--ink);
  }
  .items li span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .x {
    flex: none;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--ink-3);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }
  .x:focus-visible {
    background: var(--surface-2);
    color: var(--critical-ink);
  }
  @media (hover: hover) {
    .x:hover {
      background: var(--surface-2);
      color: var(--critical-ink);
    }
  }
  .add {
    display: flex;
    gap: var(--space-2);
  }
  .add input {
    flex: 1;
    min-width: 0;
  }
  .plus {
    flex: none;
    min-width: 40px;
    font-size: var(--text-lg);
    line-height: 1;
  }
  .field .help {
    font-size: var(--text-xs);
    color: var(--ink-3);
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
</style>
