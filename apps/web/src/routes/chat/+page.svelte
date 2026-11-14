<script lang="ts">
  /**
   * Chat with Claude Code: the real `claude` CLI in the terminal container, on its own login, in /workspace
   * (services/terminal/chat.mjs). The terminal at the bottom stays as the backup mode. A critical change
   * Claude tries comes up here as a card to allow or deny; its questions come up with their options.
   */
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Mascot from '#lib/Mascot.svelte';
  import { dock, openDock } from '#lib/dock/dock.svelte.ts';
  import { apply, emptyView, type ChatEvent, type Item, type View } from '#lib/chat/events.ts';
  import { markdown } from '#lib/chat/markdown.ts';
  import { chatHandoff } from '#lib/chat/handoff.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  let { data } = $props();
  const t = useT();

  interface ChatMeta {
    id: string;
    title: string;
    updated: number;
    busy?: boolean;
  }

  let chats = $state<ChatMeta[]>([]);
  let view = $state<View>(emptyView());
  let text = $state('');
  let sending = $state(false);
  let problem = $state('');
  let locked = $state(false);
  let showList = $state(false);
  let scroller = $state<HTMLElement>();
  let box = $state<HTMLTextAreaElement>();
  let stream: EventSource | null = null;

  const current = $derived(page.url.searchParams.get('c') ?? '');
  const canAct = $derived(!locked && (data.canAct || !!dock.status?.unlocked));
  const title = $derived(chats.find((c) => c.id === current)?.title ?? '');

  async function api(path: string, init?: { method?: string; body?: unknown }): Promise<Response | null> {
    const res = await fetch(`/chat/api${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined
    }).catch(() => null);
    if (res?.status === 403) {
      locked = true;
      problem = '';
    } else if (!res || res.status >= 500) problem = t('The terminal container is not reachable.');
    else problem = '';
    return res;
  }

  async function loadList() {
    const res = await api('');
    if (res?.ok) chats = (await res.json()).chats ?? [];
  }

  function nearBottom() {
    return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  }
  async function toBottom(force = false) {
    const stick = force || nearBottom();
    await tick();
    if (stick && scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function open(id: string) {
    stream?.close();
    stream = null;
    view = emptyView();
    if (!id) return;
    stream = new EventSource(`/chat/api/${id}/stream?from=0`);
    stream.onmessage = (m) => {
      const wasBusy = view.busy;
      apply(view, JSON.parse(m.data) as ChatEvent);
      if (wasBusy && !view.busy) loadList();
      toBottom();
    };
    toBottom(true);
  }

  $effect(() => {
    const id = current;
    open(id);
    showList = false;
  });

  async function send(message = text) {
    const msg = message.trim();
    if (!msg || sending) return;
    sending = true;
    if (current) {
      const res = await api(`/${current}/send`, { method: 'POST', body: { text: msg } });
      if (res?.ok) text = '';
    } else {
      const res = await api('', { method: 'POST', body: { text: msg } });
      if (res?.ok) {
        const { id } = await res.json();
        text = '';
        await goto(`/chat?c=${id}`);
        loadList();
      } else if (message !== text) text = msg;
    }
    sending = false;
    toBottom(true);
    box?.focus();
  }

  async function answer(rid: string, allow: boolean, answers?: Record<string, string>) {
    await api(`/${current}/answer`, { method: 'POST', body: { rid, allow, answers } });
  }

  async function remove(id: string) {
    if (!confirm(t('Delete this chat?'))) return;
    await api(`/${id}`, { method: 'DELETE' });
    if (id === current) await goto('/chat');
    loadList();
  }

  function unlock() {
    locked = false;
    dock.unlockAsked = true;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // Answers being picked on question cards, by request id.
  let picks = $state<Record<string, Record<string, string[]>>>({});
  let others = $state<Record<string, Record<string, string>>>({});
  function toggle(rid: string, q: string, label: string, multi: boolean) {
    const cur = picks[rid]?.[q] ?? [];
    const next = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label];
    picks[rid] = { ...picks[rid], [q]: next };
  }
  function answersFor(item: Extract<Item, { kind: 'ask' }>) {
    const out: Record<string, string> = {};
    for (const q of item.questions ?? []) {
      const own = others[item.rid]?.[q.question]?.trim();
      const chosen = picks[item.rid]?.[q.question] ?? [];
      const value = [...chosen, ...(own ? [own] : [])].join(', ');
      if (value) out[q.question] = value;
    }
    return out;
  }
  const allAnswered = (item: Extract<Item, { kind: 'ask' }>) => Object.keys(answersFor(item)).length === (item.questions?.length ?? 0);

  const ago = (ms: number) => {
    const d = new Date(ms);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(t.locale, { day: 'numeric', month: 'short' });
  };

  onMount(() => {
    loadList();
    // A request handed over by another page (askAgent / draftForAgent) starts a new chat.
    if (chatHandoff.ask || chatHandoff.draft) {
      const { ask, draft } = chatHandoff;
      chatHandoff.ask = chatHandoff.draft = '';
      if (current) goto('/chat');
      if (ask) send(ask);
      else {
        text = draft;
        tick().then(() => box?.focus());
      }
    }
    return () => stream?.close();
  });
</script>

<svelte:head><title>{title || t('Chat')} · {t('Assistant')}</title></svelte:head>

<div class="chat chat-page" class:list-open={showList}>
  <aside class="list" aria-label={t('Chats')}>
    <div class="list-head">
      <a class="btn btn-primary new" href="/chat" aria-current={!current ? 'page' : undefined}>{t('New chat')}</a>
    </div>
    {#if chats.length}
      <ul>
        {#each chats as c (c.id)}
          <li class:on={c.id === current}>
            <a href="/chat?c={c.id}" aria-current={c.id === current ? 'page' : undefined}>
              <span class="ct">{c.title || t('Chat')}</span>
              <span class="meta">{#if c.busy}<span class="dot" aria-hidden="true"></span>{t('working')}{:else}{ago(c.updated)}{/if}</span>
            </a>
            <button type="button" class="del btn-ghost" title={t('Delete this chat?')} onclick={() => remove(c.id)}>×<span class="sr">{t('Delete')}</span></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="meta empty-list">{t('No chats yet.')}</p>
    {/if}
  </aside>

  <section class="main">
    <header class="top">
      <button type="button" class="btn-ghost lists" onclick={() => (showList = !showList)} aria-expanded={showList}>☰<span class="sr">{t('Chats')}</span></button>
      <h1>{title || t('Chat with Claude')}</h1>
      <div class="segmented" role="group" aria-label={t('Mode')}>
        <a href="/chat" aria-current="true">{t('Chat')}</a>
        <a href="#terminal" onclick={(e) => (e.preventDefault(), openDock())}>{t('Terminal')}</a>
      </div>
    </header>

    <div class="scroll" bind:this={scroller}>
      {#if !current && !view.items.length}
        <div class="hello">
          <Mascot mood="idle" size={88} accessory="headphones" decorative />
          <h2>{t('What should Claude do?')}</h2>
          <p class="muted">{t('Claude Code works in the app’s own folder, with your Claude login. It asks here before critical changes.')}</p>
          {#if !data.configured || !data.reachable}<p class="note bad">{t('The terminal container is not reachable.')}</p>
          {:else if !data.signedIn}<p class="note">{t('Claude Code is not signed in yet: System settings → Terminal and AI.')}</p>{/if}
        </div>
      {/if}

      <ol class="items">
        {#each view.items as item, i (i)}
          <li class="item {item.kind}">
            {#if item.kind === 'user'}
              <div class="bubble">{item.text}</div>
            {:else if item.kind === 'text'}
              <div class="md">{@html markdown(item.text)}</div>
            {:else if item.kind === 'error'}
              <p class="note bad" role="alert">{item.text}</p>
            {:else if item.kind === 'tool'}
              <details class="tool" class:bad={item.result?.error}>
                <summary>
                  <span class="tname">{item.name}</span>
                  <code>{item.summary}</code>
                  {#if !item.result}<span class="spin" aria-label={t('running')}></span>{/if}
                </summary>
                {#if item.result?.text}<pre>{item.result.text}</pre>{/if}
              </details>
            {:else if item.kind === 'ask'}
              <div class="card ask" class:open={item.state === 'open'}>
                {#if item.questions}
                  <div class="ask-head"><Mascot mood="steady" size={28} decorative /><strong>{t('Claude asks')}</strong></div>
                  {#each item.questions as q (q.question)}
                    <fieldset disabled={item.state !== 'open'}>
                      <legend>{q.question}</legend>
                      <div class="opts">
                        {#each q.options as o (o.label)}
                          {@const on = item.state === 'open' ? (picks[item.rid]?.[q.question] ?? []).includes(o.label) : (item.answers?.[q.question] ?? '').split(', ').includes(o.label)}
                          <button type="button" class="opt" class:on aria-pressed={on} title={o.description} onclick={() => toggle(item.rid, q.question, o.label, q.multi)}>
                            <span>{o.label}</span>
                            {#if o.description}<span class="meta">{o.description}</span>{/if}
                          </button>
                        {/each}
                      </div>
                      {#if item.state === 'open'}
                        <input class="other" placeholder={t('Other answer…')} value={others[item.rid]?.[q.question] ?? ''} oninput={(e) => (others[item.rid] = { ...others[item.rid], [q.question]: e.currentTarget.value })} />
                      {/if}
                    </fieldset>
                  {/each}
                  {#if item.state === 'open'}
                    <div class="actions">
                      <button type="button" class="btn btn-primary" disabled={!canAct || !allAnswered(item)} onclick={() => answer(item.rid, true, answersFor(item))}>{t('Send the answer')}</button>
                      <button type="button" class="btn" disabled={!canAct} onclick={() => answer(item.rid, false)}>{t('Skip')}</button>
                    </div>
                  {/if}
                {:else}
                  <div class="ask-head"><Mascot mood="tired" size={28} decorative /><strong>{t('Claude asks for your approval')}</strong><span class="meta">{item.tool}</span></div>
                  <pre class="what">{item.summary}</pre>
                  {#if item.reason}<p class="meta">{item.reason}</p>{/if}
                  {#if item.state === 'open'}
                    <div class="actions">
                      <button type="button" class="btn btn-primary" disabled={!canAct} onclick={() => answer(item.rid, true)}>{t('Allow')}</button>
                      <button type="button" class="btn" disabled={!canAct} onclick={() => answer(item.rid, false)}>{t('Deny')}</button>
                    </div>
                  {/if}
                {/if}
                {#if item.state !== 'open'}
                  <p class="verdict small {item.state}">
                    {item.state === 'allowed' ? (item.questions ? t('Answered') : t('Allowed')) : item.state === 'denied' ? (item.questions ? t('Skipped') : t('Denied')) : t('No longer waiting (Claude Code stopped)')}
                  </p>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
        {#if view.live}<li class="item text"><div class="md">{@html markdown(view.live)}</div></li>{/if}
        {#if view.busy && !view.live}
          <li class="item thinking" role="status"><Mascot mood="charged" size={28} accessory="headphones" decorative /><span class="meta">{t('Claude is working…')}</span></li>
        {/if}
      </ol>
    </div>

    <form class="composer" onsubmit={(e) => (e.preventDefault(), send())}>
      {#if problem}<p class="note bad small" role="alert">{problem}</p>{/if}
      {#if !canAct}
        <p class="note small">{t('Claude acts with full access: unlock first (the lock in the header).')} <button type="button" class="btn" onclick={unlock}>{t('Unlock')}</button></p>
      {/if}
      <div class="row">
        <textarea bind:this={box} bind:value={text} rows="2" placeholder={current ? t('Reply to Claude…') : t('Ask Claude to do something…')} onkeydown={onKey} aria-label={t('Message')}></textarea>
        {#if view.busy}
          <button type="button" class="btn" onclick={() => api(`/${current}/stop`, { method: 'POST' })}>{t('Stop')}</button>
        {/if}
        <button class="btn btn-primary" disabled={!text.trim() || sending || !canAct}>{t('Send')}</button>
      </div>
    </form>
  </section>
</div>

<style>
  .chat {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: var(--space-4);
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--space-4);
    height: calc(100dvh - 57px - var(--dock-h, 0px));
    min-height: 420px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }
  .new {
    width: 100%;
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: grid;
    gap: 2px;
  }
  .list li {
    position: relative;
    border-radius: var(--radius-sm);
  }
  .list li.on {
    background: var(--surface-2);
  }
  .list li a {
    display: grid;
    gap: 2px;
    padding: var(--space-2) 28px var(--space-2) var(--space-3);
    color: var(--ink);
    text-decoration: none;
  }
  @media (hover: hover) {
    .list li:hover {
      background: var(--surface-2);
    }
  }
  .ct {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .meta {
    color: var(--ink-3);
    font-size: var(--text-xs);
  }
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--good);
  }
  .del {
    position: absolute;
    right: 4px;
    top: 50%;
    translate: 0 -50%;
    height: 24px;
    opacity: 0;
  }
  .list li:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .empty-list {
    padding: 0 var(--space-3);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--ring);
    border-radius: var(--radius);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--ring);
  }
  .top h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lists {
    display: none;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }
  .hello {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
  }
  .hello h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-lg);
  }
  .items {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    max-width: 760px;
    display: grid;
    gap: var(--space-3);
  }
  .item.user {
    justify-self: end;
    max-width: 85%;
  }
  .bubble {
    padding: var(--space-2) var(--space-3);
    border-radius: 14px 14px 4px 14px;
    background: var(--accent-wash);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .md {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(pre),
  .md :global(blockquote) {
    margin: 0 0 var(--space-2);
  }
  .md :global(:last-child) {
    margin-bottom: 0;
  }
  .md :global(pre),
  .tool pre,
  pre.what {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font: var(--text-sm) / 1.45 var(--mono);
    overflow-x: auto;
    white-space: pre-wrap;
  }
  .md :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
  }
  .md :global(:not(pre) > code) {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .md :global(blockquote) {
    padding-left: var(--space-3);
    border-left: 3px solid var(--axis);
    color: var(--ink-2);
  }
  .md :global(h3),
  .md :global(h4),
  .md :global(h5) {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-base);
  }
  .tool {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .tool summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    min-width: 0;
  }
  .tool summary code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    font-family: var(--mono);
  }
  .tname {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--hue-violet) 14%, transparent);
    color: var(--hue-violet);
    font-weight: var(--weight-medium);
  }
  .tool.bad .tname {
    background: color-mix(in srgb, var(--critical) 14%, transparent);
    color: var(--critical-ink);
  }
  .tool pre {
    margin: var(--space-2) 0 0;
    max-height: 300px;
    overflow-y: auto;
  }
  .spin {
    flex: none;
    width: 12px;
    height: 12px;
    border: 2px solid var(--axis);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
  .ask {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .ask.open {
    border-color: color-mix(in srgb, var(--warning) 70%, var(--ring));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent);
  }
  .ask-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  pre.what {
    margin: 0;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  legend {
    font-weight: var(--weight-medium);
    margin-bottom: var(--space-2);
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .opt {
    display: grid;
    text-align: left;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--ring);
    border-radius: var(--radius-sm);
    background: var(--surface);
    max-width: 280px;
  }
  .opt.on {
    border-color: var(--accent);
    background: var(--accent-wash);
  }
  .other {
    max-width: 360px;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .verdict {
    margin: 0;
    font-weight: var(--weight-medium);
    color: var(--ink-2);
  }
  .verdict.allowed {
    color: var(--good-ink);
  }
  .verdict.denied {
    color: var(--critical-ink);
  }
  .thinking {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .composer {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--ring);
    display: grid;
    gap: var(--space-2);
  }
  .composer .row {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .composer textarea {
    flex: 1;
    resize: none;
    max-height: 200px;
    field-sizing: content;
    min-height: 44px;
    font-family: var(--font);
  }
  .composer .note {
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-left: 3px solid var(--ink-4);
  }
  .note.bad {
    border-left-color: var(--critical);
  }
  .small {
    font-size: var(--text-sm);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  @media (max-width: 760px) {
    .chat {
      grid-template-columns: 1fr;
      padding: var(--space-2);
    }
    .list {
      display: none;
    }
    .list-open .list {
      display: flex;
      max-height: 40dvh;
    }
    .lists {
      display: inline-block;
    }
  }
</style>
