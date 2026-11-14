<script lang="ts">
  /**
   * Chat with Claude Code, the way to use AI in the app: the real `claude` CLI in the terminal container, on
   * its own login, in /workspace (services/terminal/chat.mjs). A panel that slides in from the right on every
   * page (panel.svelte.ts). A critical change Claude tries comes up here as a card to allow or deny; its
   * questions come up with their options. Acting needs the app's unlock (the lock in the header).
   */
  import { tick, untrack } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import { dock, refreshDock, unlocked } from '#lib/dock/dock.svelte.ts';
  import { apply, emptyView, type ChatEvent, type Item, type View } from './events.ts';
  import { markdown } from './markdown.ts';
  import { chatHandoff } from './handoff.svelte.ts';
  import { chatPanel, closeChat } from './panel.svelte.ts';
  import { useT } from '#lib/i18n/index.ts';

  /** The terminal's bar is at the bottom of the page: the panel ends above it. */
  let { docked = false }: { docked?: boolean } = $props();
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
  /** The terminal container answers /chat with 404: it still runs a version from before the chat. */
  let outdated = $state(false);
  let showList = $state(false);
  let panel = $state<HTMLElement>();
  let scroller = $state<HTMLElement>();
  let box = $state<HTMLTextAreaElement>();
  let stream: EventSource | null = null;

  const current = $derived(chatPanel.current);
  const canAct = $derived(unlocked());
  const title = $derived(chats.find((c) => c.id === current)?.title ?? '');
  const status = $derived(dock.status);

  async function api(path: string, init?: { method?: string; body?: unknown }): Promise<Response | null> {
    const res = await fetch(`/chat/api${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined
    }).catch(() => null);
    outdated = res?.status === 404;
    if (res?.status === 403) {
      problem = '';
      refreshDock();
    } else if (!res || res.status >= 500) problem = t('The terminal container is not reachable.');
    else if (!res.ok && !outdated) problem = t('Claude did not take the message ({status}).', { status: res.status });
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

  /** A new conversation, or another one from the list. */
  function show(id: string) {
    chatPanel.current = id;
    tick().then(() => box?.focus());
  }

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
        chatPanel.current = id;
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
    if (id === current) chatPanel.current = '';
    loadList();
  }

  function unlock() {
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

  // Each time the panel opens: a fresh list and state, focus in the message box.
  $effect(() => {
    if (!chatPanel.open) return;
    untrack(() => {
      loadList();
      refreshDock();
      tick().then(() => box?.focus());
    });
  });

  // A request handed over by another page (askAgent / draftForAgent) starts a new chat.
  $effect(() => {
    if (!chatPanel.open || !(chatHandoff.ask || chatHandoff.draft)) return;
    untrack(() => {
      const { ask, draft } = chatHandoff;
      chatHandoff.ask = chatHandoff.draft = '';
      chatPanel.current = '';
      if (ask) tick().then(() => send(ask));
      else text = draft;
    });
  });

  $effect(() => () => stream?.close());

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && chatPanel.open && panel?.contains(e.target as Node)) closeChat();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<aside class="chat" class:open={chatPanel.open} class:docked class:list-open={showList} bind:this={panel} inert={!chatPanel.open} aria-label={t('Chat with Claude')}>
  <header class="top">
    <button type="button" class="btn-ghost icon" onclick={() => (showList = !showList)} aria-expanded={showList} aria-controls="chat-list" title={t('Chats')}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12" /></svg><span class="sr">{t('Chats')}</span>
    </button>
    <h2>{title || t('Chat with Claude')}</h2>
    <button type="button" class="btn-ghost icon" onclick={() => show('')} disabled={!current} title={t('New chat')}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg><span class="sr">{t('New chat')}</span>
    </button>
    <button type="button" class="btn-ghost icon" onclick={closeChat} title={t('Close')}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg><span class="sr">{t('Close')}</span>
    </button>
  </header>

  <nav class="list" id="chat-list" aria-label={t('Chats')}>
    {#if chats.length}
      <ul>
        {#each chats as c (c.id)}
          <li class:on={c.id === current}>
            <button type="button" class="pick" aria-current={c.id === current ? 'true' : undefined} onclick={() => show(c.id)}>
              <span class="ct">{c.title || t('Chat')}</span>
              <span class="meta">{#if c.busy}<span class="dot" aria-hidden="true"></span>{t('working')}{:else}{ago(c.updated)}{/if}</span>
            </button>
            <button type="button" class="del btn-ghost" title={t('Delete this chat?')} onclick={() => remove(c.id)}>×<span class="sr">{t('Delete')}</span></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="meta empty-list">{t('No chats yet.')}</p>
    {/if}
  </nav>

  <section class="main">
    <div class="scroll" bind:this={scroller}>
      {#if !current && !view.items.length}
        <div class="hello">
          <Mascot mood="idle" size={88} accessory="headphones" decorative />
          <h2>{t('What should Claude do?')}</h2>
          <p class="muted">{t('Claude Code works in the app’s own folder, with your Claude login. It asks here before critical changes.')}</p>
          {#if status && (!status.configured || !status.reachable)}<p class="note bad">{t('The terminal container is not reachable.')}</p>
          {:else if status && !status.claude}<p class="note">{t('Claude Code is not signed in yet: System settings → Terminal and AI.')}</p>{/if}
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
      {#if outdated}
        <p class="note bad small" role="alert">
          {t('The terminal container still runs a version without the chat. Restart it to use the chat.')}
          <a href="/settings/updates" onclick={closeChat}>{t('Updates')}</a>
        </p>
      {/if}
      {#if !canAct}
        <p class="note small">{t('Claude acts with full access: unlock first (the lock in the header).')} <button type="button" class="btn" onclick={unlock}>{t('Unlock')}</button></p>
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="box" class:off={!canAct} onclick={(e) => e.target === e.currentTarget && box?.focus()}>
        <textarea bind:this={box} bind:value={text} rows="1" placeholder={current ? t('Reply to Claude…') : t('Ask Claude to do something…')} onkeydown={onKey} aria-label={t('Message')}></textarea>
        <div class="tools">
          <span class="hint">{t('Enter sends, Shift+Enter makes a new line')}</span>
          {#if view.busy}
            <button type="button" class="round stop" title={t('Stop')} onclick={() => api(`/${current}/stop`, { method: 'POST' })}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.5" /></svg><span class="sr">{t('Stop')}</span>
            </button>
          {/if}
          <button class="round send" title={t('Send')} disabled={!text.trim() || sending || !canAct}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" /></svg><span class="sr">{t('Send')}</span>
          </button>
        </div>
      </div>
    </form>
  </section>
</aside>

<style>
  /* Under the header (and its menus, z-index 10), so the lock with its password prompt and the chat button
     stay in reach; above the terminal's bar when that is on. */
  .chat {
    position: fixed;
    top: 57px;
    right: 0;
    bottom: 0;
    z-index: 9;
    display: flex;
    flex-direction: column;
    width: min(460px, 100vw);
    background: var(--surface);
    border-left: 1px solid var(--ring);
    box-shadow: -16px 0 40px -24px rgb(0 0 0 / 45%);
    transform: translateX(100%);
    visibility: hidden;
    transition:
      transform 0.22s ease,
      visibility 0s 0.22s;
  }
  .chat.docked {
    bottom: calc(41px + env(safe-area-inset-bottom, 0px));
  }
  .chat.open {
    transform: none;
    visibility: visible;
    transition: transform 0.22s ease;
  }
  :global([data-motion='reduce']) .chat {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .chat {
      transition: none;
    }
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 48px;
    flex: none;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-bottom: 1px solid var(--ring);
  }
  .top h2 {
    flex: 1;
    min-width: 0;
    margin: 0 var(--space-1);
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    flex: none;
  }
  .icon svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
  }
  .list {
    display: none;
    flex: none;
    max-height: 45%;
    overflow-y: auto;
    padding: var(--space-2);
    border-bottom: 1px solid var(--ring);
  }
  .list-open .list {
    display: block;
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
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
  .pick {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: var(--space-2) 28px var(--space-2) var(--space-3);
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
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
    flex: 1;
    flex-direction: column;
    min-height: 0;
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
    flex: none;
    padding: var(--space-2) var(--space-3) var(--space-3);
    display: grid;
    gap: var(--space-2);
  }
  .box {
    display: grid;
    gap: 2px;
    padding: 10px 10px 8px 14px;
    border: 1px solid var(--field-border);
    border-radius: 18px;
    background: var(--surface-2);
    cursor: text;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-wash);
  }
  .box.off {
    opacity: 0.6;
  }
  .box textarea {
    width: 100%;
    min-height: 24px;
    max-height: 200px;
    padding: 2px 0;
    border: 0;
    background: none;
    resize: none;
    field-sizing: content;
    font-family: var(--font);
    line-height: 1.5;
    outline: none;
    box-shadow: none;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hint {
    flex: 1;
    min-width: 0;
    color: var(--ink-3);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .round {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }
  .round svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .send {
    background: var(--accent);
    color: #fff;
  }
  .send:disabled {
    background: var(--ring);
    color: var(--ink-3);
    cursor: default;
  }
  .stop {
    background: var(--surface);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ring);
  }
  .stop svg {
    fill: currentColor;
    stroke: none;
  }
  @media (pointer: coarse) {
    .hint {
      visibility: hidden;
    }
    .round {
      width: 40px;
      height: 40px;
    }
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
</style>
