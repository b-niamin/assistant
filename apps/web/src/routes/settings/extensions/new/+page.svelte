<script lang="ts">
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import { buildPrompt, IDEAS, PENDING_PROMPT_KEY, TEMPLATES, type Scope } from '$lib/settings/guide';

  let { data } = $props();

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

  function openTerminal() {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
    } catch {
      /* private mode: the terminal page shows nothing to run, copy still works */
    }
    goto('/settings/terminal#ready');
  }
</script>

<svelte:head><title>Add an app · System settings</title></svelte:head>

<div class="hero">
  <Mascot mood="charged" size={72} decorative />
  <div>
    <p class="eyebrow"><a href="/settings">System settings</a></p>
    <h1>Add an app</h1>
    <p class="lede">
      Apps are not downloaded here: you describe one, and Claude builds it for you inside the assistant, in our
      look and with Pip. It takes a few minutes, then the app shows up in the menu and in System settings.
    </p>
  </div>
</div>

<ol class="how" aria-label="How it works">
  <li><span class="n">1</span><span><strong>Describe it</strong> below, optionally with a link for inspiration.</span></li>
  <li><span class="n">2</span><span><strong>Open the terminal</strong>: Claude Code starts with your request.</span></li>
  <li><span class="n">3</span><span><strong>Watch it build</strong>, answer if it asks, and the app appears here.</span></li>
</ol>

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
        <p class="meta warn">
          The terminal is not available right now. Copy the request and paste it to Claude in Remote Control instead.
        </p>
      {:else if !data.terminal.claude}
        <p class="meta warn">
          Claude Code is not signed in yet. The terminal page has a Sign in button; do that first, then run the request.
        </p>
      {:else}
        <p class="meta">You can also paste it to Claude in Remote Control; it works the same.</p>
      {/if}
    </section>

    {#if data.installed.length}
      <p class="meta installed">Already installed: {data.installed.join(', ')}.</p>
    {/if}
  </aside>
</div>

<style>
  .hero {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }
  .hero h1,
  .hero p {
    margin: 0;
  }
  .hero > div {
    display: grid;
    gap: var(--space-1);
  }
  .lede {
    color: var(--ink-2);
    max-width: 68ch;
  }
  .how {
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .how li {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    color: var(--ink-2);
    font-size: 0.875rem;
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
