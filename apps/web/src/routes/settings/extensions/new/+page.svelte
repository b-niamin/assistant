<script lang="ts">
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import {
    buildPrompt,
    hueFor,
    IDEAS,
    initials,
    inspirationPrompt,
    installCommand,
    PENDING_PROMPT_KEY,
    TEMPLATES,
    type PendingTask,
    type Scope
  } from '$lib/settings/guide';

  let { data } = $props();

  const installedIds = $derived(new Set(data.installed.map((e) => e.id)));
  let copiedId = $state('');

  let idea = $state('');
  let inspiration = $state('');
  let scope = $state<Scope>('profile');
  let template = $state('auto');
  let edited = $state<string | null>(null);
  let copied = $state(false);

  const generated = $derived(buildPrompt({ idea, inspiration, scope, template }));
  const prompt = $derived(edited ?? generated);
  const ready = $derived(idea.trim().length > 3);
  const termOk = $derived(data.terminal.configured && data.terminal.reachable);

  function pickIdea(i: (typeof IDEAS)[number]) {
    idea = i.text;
    template = i.template;
    scope = i.scope;
    edited = null;
  }

  function pickTemplate(id: string) {
    template = id;
    const t = TEMPLATES.find((x) => x.id === id);
    if (t?.scope) scope = t.scope;
    edited = null;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  }

  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedId = id;
      setTimeout(() => (copiedId = ''), 1800);
    } catch {
      /* clipboard blocked */
    }
  }

  function toTerminal(task: PendingTask) {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(task));
    } catch {
      /* private mode: the terminal page shows nothing to run, copy still works */
    }
    goto('/settings/terminal#ready');
  }

  const openTerminal = () => toTerminal({ tool: 'claude', text: prompt, title: 'Ready to build your app' });

  /** Fill the form below with an inspiration, to change it before building. */
  function adapt(i: (typeof data.catalog.inspirations)[number]) {
    idea = i.idea;
    scope = i.scope;
    template = TEMPLATES.some((t) => t.id === i.id) ? i.id : 'auto';
    edited = null;
    document.getElementById('own')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollRow(id: string, dir: number) {
    const el = document.getElementById(id);
    el?.scrollBy({ left: dir * Math.max(260, el.clientWidth * 0.8), behavior: 'smooth' });
  }

  const CHAT_STARTER =
    'Use the add-extension skill to add a new extension to this assistant: <describe the app>. ' +
    'Use our design system and Beni the mascot, run the checks, commit and push.';
</script>

<svelte:head><title>Extend the system · System settings</title></svelte:head>

<div class="hero">
  <div class="head">
    <p class="eyebrow"><a href="/settings">System settings</a></p>
    <h1>Extend the system</h1>
    <p class="lede">
      Install a ready-made app, let your AI build one from an inspiration, or describe your own. Every app wears
      our look and has Beni; it shows up in the menu and in System settings.
    </p>
  </div>
  <div class="pip">
    <p class="bubble">Pick an app, or tell me what you need. I'll help build it!</p>
    <Mascot mood="charged" size={112} decorative />
  </div>
</div>

{#if !termOk}
  <p class="meta warn notice">
    The terminal is not available right now, so the buttons below cannot run anything. Copy a command or a request
    and use it in Remote Control instead.
  </p>
{/if}

<section class="block" aria-labelledby="ready-h">
  <div class="sh">
    <div class="sh-t">
      <Mascot mood="charged" size={40} decorative />
      <div>
      <h2 id="ready-h">Ready to install</h2>
      <p class="meta">Finished apps from the extensions repo. One tap copies them in and turns them on.</p>
      </div>
    </div>
    <div class="arrows">
      <button type="button" class="btn-ghost arrow" aria-label="Previous" onclick={() => scrollRow('row-ready', -1)}>‹</button>
      <button type="button" class="btn-ghost arrow" aria-label="Next" onclick={() => scrollRow('row-ready', 1)}>›</button>
    </div>
  </div>
  {#if data.catalog.error}
    <div class="none card"><Mascot mood="tired" size={48} decorative />
      <p class="meta">{data.catalog.error} In the terminal: <code>node scripts/ext.mjs available</code></p></div>
  {:else}
    <ul class="row" id="row-ready">
      {#each data.catalog.extensions as e (e.id)}
        {@const on = installedIds.has(e.id)}
        <li class="card tile" style="--hue: {hueFor(e.id)}">
          <div class="top">
            <span class="mark" aria-hidden="true">{initials(e.name)}</span>
            <span class="tags">
              <span class="tag">{e.kind === 'native' ? 'App' : 'One-file app'}</span>
              <span class="tag">{e.scope === 'shared' ? 'Shared' : 'Per person'}</span>
            </span>
          </div>
          <h3>{e.name}</h3>
          <p class="meta grow">{e.description}</p>
          {#if e.needs}<p class="meta small">Needs: {e.needs}</p>{/if}
          {#if on}
            <a class="btn" href="/settings/extensions/{e.id}">Installed · settings</a>
          {:else}
            <button type="button" class="btn btn-primary" disabled={!termOk}
              onclick={() => toTerminal({ tool: 'shell', text: installCommand(e.id), title: `Install ${e.name}` })}>
              Install
            </button>
            {#if e.service}
              <p class="meta small">Has a background service: afterwards run <code>sudo ./install.sh</code> on the host once.</p>
            {/if}
          {/if}
        </li>
      {:else}
        <li class="none"><Mascot mood="idle" size={48} decorative /><span class="meta">Nothing in the extensions repo yet.</span></li>
      {/each}
    </ul>
  {/if}
</section>

<section class="block" aria-labelledby="insp-h">
  <div class="sh">
    <div class="sh-t">
      <Mascot mood="steady" size={40} decorative />
      <div>
      <h2 id="insp-h">Inspirations for your AI</h2>
      <p class="meta">Starting points Claude or Codex turn into an app made for you, in a few minutes.</p>
      </div>
    </div>
    <div class="arrows">
      <button type="button" class="btn-ghost arrow" aria-label="Previous" onclick={() => scrollRow('row-insp', -1)}>‹</button>
      <button type="button" class="btn-ghost arrow" aria-label="Next" onclick={() => scrollRow('row-insp', 1)}>›</button>
    </div>
  </div>
  {#if !data.catalog.error}
    <ul class="row" id="row-insp">
      {#each data.catalog.inspirations as i (i.id)}
        {@const p = inspirationPrompt(i)}
        <li class="card tile insp" style="--hue: {hueFor(i.id)}">
          <div class="top">
            <span class="mark" aria-hidden="true">{initials(i.name)}</span>
            <span class="tags"><span class="tag">{i.scope === 'shared' ? 'Shared' : 'Per person'}</span></span>
          </div>
          <h3>{i.name}</h3>
          <p class="meta grow">{i.description}</p>
          <div class="acts">
            <button type="button" class="btn btn-primary" disabled={!termOk || !data.terminal.claude}
              onclick={() => toTerminal({ tool: 'claude', text: p, title: `Build ${i.name} with Claude` })}>
              Build with Claude
            </button>
            <button type="button" class="btn" disabled={!termOk || !data.terminal.codex}
              onclick={() => toTerminal({ tool: 'codex', text: p, title: `Build ${i.name} with Codex` })}>
              Codex
            </button>
          </div>
          <div class="acts small-acts">
            <button type="button" class="btn-ghost" onclick={() => adapt(i)}>Adapt first</button>
            <button type="button" class="btn-ghost" onclick={() => copyText(i.id, p)}>{copiedId === i.id ? 'Copied' : 'Copy request'}</button>
          </div>
        </li>
      {/each}
      <li class="card tile insp" style="--hue: var(--hue-magenta)">
        <div class="top">
          <span class="mark" aria-hidden="true">1F</span>
          <span class="tags"><span class="tag">One-file apps</span></span>
        </div>
        <h3>From onefile-apps</h3>
        <p class="meta grow">Any app from the onefile-apps catalogue: a log, a list, a timer, a tracker. Claude picks the closest one.</p>
        <button type="button" class="btn" onclick={() => { pickTemplate('onefile'); document.getElementById('own')?.scrollIntoView({ behavior: 'smooth' }); }}>
          Describe it below
        </button>
      </li>
    </ul>
    {#if !data.terminal.claude && !data.terminal.codex && termOk}
      <p class="meta warn">Sign in to Claude Code or Codex in the <a href="/settings/terminal">terminal</a> first.</p>
    {/if}
  {/if}
</section>

<section class="block chat card" aria-labelledby="chat-h">
  <Mascot mood="steady" size={56} decorative />
  <div class="chat-body">
    <h2 id="chat-h">Or just ask in a chat</h2>
    <p class="meta">
      Open Claude on claude.ai or in the Claude app on your phone (the same account you signed in with here), go to
      <strong>Code</strong>, pick this assistant's Remote Control session and describe the app in your own words.
      Claude builds it here while you chat.
    </p>
  </div>
  <button type="button" class="btn" onclick={() => copyText('chat', CHAT_STARTER)}>{copiedId === 'chat' ? 'Copied' : 'Copy a starter'}</button>
</section>

<div class="sh own-h" id="own">
  <div>
    <h2>Or describe your own</h2>
    <p class="meta">A short form that becomes a ready request for Claude in the terminal.</p>
  </div>
</div>

<div class="grid">
  <div class="form">
    <section class="card">
      <h2><span class="n">1</span> What should it do?</h2>
      <label class="sr" for="idea">Describe the app</label>
      <textarea id="idea" bind:value={idea} oninput={() => (edited = null)} rows="3"
        placeholder="e.g. Show my Home Assistant rooms and today's energy use"></textarea>
      <div class="chips" aria-label="Ideas">
        {#each IDEAS as i (i.label)}
          <button type="button" class="chip" class:on={idea === i.text} onclick={() => pickIdea(i)}>{i.label}</button>
        {/each}
      </div>
      <label class="field">
        <span>Inspiration (optional): a GitHub repo, an app, a web page</span>
        <input type="url" bind:value={inspiration} oninput={() => (edited = null)} placeholder="https://github.com/..." />
      </label>
    </section>

    <section class="card">
      <h2><span class="n">2</span> Whose data is it?</h2>
      <div class="scopes" role="radiogroup" aria-label="Data scope">
        <label class="opt" class:on={scope === 'profile'}>
          <input type="radio" name="scope" value="profile" bind:group={scope} onchange={() => (edited = null)} />
          <strong>Each person's own</strong>
          <span class="meta">Training, learning, habits: every profile keeps separate data.</span>
        </label>
        <label class="opt" class:on={scope === 'shared'}>
          <input type="radio" name="scope" value="shared" bind:group={scope} onchange={() => (edited = null)} />
          <strong>Shared by everyone</strong>
          <span class="meta">The house, a family calendar, a budget: one set for all profiles.</span>
        </label>
      </div>
    </section>

    <section class="card">
      <h2><span class="n">3</span> Start from</h2>
      <div class="templates">
        {#each TEMPLATES as t (t.id)}
          <button type="button" class="tpl" class:on={template === t.id} aria-pressed={template === t.id} onclick={() => pickTemplate(t.id)}>
            <strong>{t.name}</strong>
            <span class="meta">{t.blurb}</span>
          </button>
        {/each}
      </div>
    </section>
  </div>

  <aside class="side">
    <section class="card prompt">
      <h2>Request for Claude</h2>
      <label class="sr" for="prompt">Prompt</label>
      <textarea id="prompt" value={prompt} oninput={(e) => (edited = e.currentTarget.value)} rows="9"></textarea>
      {#if edited !== null}
        <button type="button" class="btn-ghost reset" onclick={() => (edited = null)}>Undo my edits</button>
      {/if}
      <div class="go">
        <button type="button" class="btn btn-primary" disabled={!ready || !termOk} onclick={openTerminal}>
          Open terminal and build
        </button>
        <button type="button" class="btn" disabled={!ready} onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {#if !ready}
        <p class="meta">Describe the app first.</p>
      {:else if !termOk}
        <p class="meta warn">The terminal is not available right now. Copy the request and paste it to Claude in Remote Control instead.</p>
      {:else if !data.terminal.claude}
        <p class="meta warn">
          Claude Code is not signed in yet. The terminal page has a Sign in button; do that first, then run the request.
        </p>
      {:else}
        <p class="meta">You can also paste it to Claude in Remote Control; it works the same.</p>
      {/if}
    </section>

    {#if data.installed.length}
      <p class="meta installed">Already installed: {data.installed.map((e) => e.name).join(', ')}.</p>
    {/if}
  </aside>
</div>

<style>
  .block {
    margin-bottom: var(--space-5);
  }
  .notice {
    margin-bottom: var(--space-4);
  }
  .sh {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .sh h2 {
    font-size: 1.125rem;
  }
  .sh .meta {
    margin-top: 2px;
  }
  .own-h {
    margin-top: var(--space-2);
  }
  .arrows {
    display: flex;
    gap: var(--space-1);
  }
  .arrow {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 1.25rem;
    line-height: 1;
  }
  @media (hover: none) {
    .arrows {
      display: none;
    }
  }
  .row {
    list-style: none;
    margin: 0;
    padding: 2px 2px var(--space-2);
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(250px, 280px);
    gap: var(--space-3);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: thin;
  }
  .tile {
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 3px solid var(--hue);
  }
  .tile h3 {
    margin: 0;
    font-size: 1rem;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--hue) 18%, var(--surface));
    color: var(--ink);
    font-weight: 700;
  }
  .tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .tag {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--ink-2);
  }
  .grow {
    flex: 1;
  }
  .small {
    font-size: 0.75rem;
  }
  .acts {
    display: flex;
    gap: var(--space-2);
  }
  .acts .btn,
  .acts .btn-primary {
    white-space: nowrap;
  }
  .acts .btn-primary {
    flex: 1;
  }
  .small-acts {
    justify-content: space-between;
    font-size: 0.8125rem;
  }
  .none {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .sh-t {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .pip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .bubble {
    position: relative;
    max-width: 200px;
    margin: 0;
    padding: 10px 14px;
    border-radius: 16px 16px 4px 16px;
    background: var(--surface);
    border: 1px solid var(--ring);
    font-size: 0.875rem;
    color: var(--ink);
  }
  @media (max-width: 760px) {
    .bubble {
      display: none;
    }
  }
  section.card.chat {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .chat-body {
    flex: 1;
    display: grid;
    gap: var(--space-1);
  }
  @media (max-width: 640px) {
    section.card.chat {
      flex-direction: column;
      align-items: flex-start;
    }
  }
  .hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .hero h1,
  .hero p {
    margin: 0;
  }
  .head {
    display: grid;
    gap: var(--space-1);
  }
  .lede {
    color: var(--ink-2);
    max-width: 68ch;
  }
  .n {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent-wash);
    color: var(--accent-ink);
    font-size: 0.8125rem;
    font-weight: 700;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
    gap: var(--space-4);
    align-items: start;
  }
  @media (max-width: 860px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .form {
    display: grid;
    gap: var(--space-3);
  }
  section.card {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    resize: vertical;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--ring);
    background: var(--surface);
    color: var(--ink-2);
    font-size: 0.8125rem;
  }
  .chip:hover,
  .chip.on {
    border-color: var(--accent);
    color: var(--ink);
  }
  .chip.on {
    background: var(--accent-wash);
  }
  .scopes,
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-2);
  }
  .opt,
  .tpl {
    display: grid;
    gap: 2px;
    align-content: start;
    text-align: left;
    padding: var(--space-3);
    border: 1px solid var(--ring);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    font: inherit;
  }
  .opt input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .opt:has(input:focus-visible) {
    outline: 2px solid var(--accent);
  }
  .opt.on,
  .tpl.on {
    border-color: var(--accent);
    background: var(--accent-wash);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--ink-2);
    margin: 0;
  }
  .warn {
    color: var(--ink);
    border-left: 3px solid var(--warning);
    padding-left: var(--space-2);
  }
  .side {
    position: sticky;
    top: 72px;
    display: grid;
    gap: var(--space-3);
  }
  .prompt textarea {
    font: 0.8125rem/1.5 var(--mono);
    background: var(--surface-2);
  }
  .reset {
    justify-self: start;
    font-size: 0.8125rem;
  }
  .go {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .go .btn-primary {
    flex: 1;
  }
  .installed {
    padding: 0 var(--space-1);
  }
  @media (max-width: 560px) {
    .hero {
      align-items: flex-start;
    }
  }
</style>
