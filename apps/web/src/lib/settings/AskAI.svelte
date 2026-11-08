<script lang="ts">
  /**
   * A message box that starts Claude Code (or Codex) in the in-app terminal with the text as the first
   * message. Used by "Extend the system" (a new app) and by every extension's settings (change it).
   */
  import { goto } from '$app/navigation';
  import Mascot from '$lib/Mascot.svelte';
  import { PENDING_PROMPT_KEY, type PendingTask } from '$lib/settings/guide';

  let {
    title,
    placeholder,
    prompt,
    taskTitle,
    terminal,
    installed = [],
    canResume = false
  }: {
    title: string;
    placeholder: string;
    /** Turns what the person typed into the request for the AI. */
    prompt: (text: string) => string;
    taskTitle: string;
    terminal: { configured: boolean; reachable: boolean; claude: boolean; codex: boolean };
    /** Installed extension ids, so the terminal can link the new one when it appears. */
    installed?: string[];
    /** Offer "continue the last conversation" (Claude Code's -c). */
    canResume?: boolean;
  } = $props();

  let text = $state('');
  let resume = $state(false);
  let copied = $state(false);
  const ready = $derived(text.trim().length > 3);
  const termOk = $derived(terminal.configured && terminal.reachable);

  function start(tool: 'claude' | 'codex') {
    const task: PendingTask = { tool, text: prompt(text), title: taskTitle, before: installed };
    if (tool === 'claude' && resume) task.resume = true;
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(task));
    } catch {
      /* private mode: copy still works */
    }
    goto('/settings/terminal#ready');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt(text));
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* clipboard blocked */
    }
  }
</script>

<form class="card ask" onsubmit={(e) => { e.preventDefault(); if (ready && termOk && terminal.claude) start('claude'); }}>
  <div class="who">
    <Mascot mood="steady" size={44} decorative />
    <strong>{title}</strong>
  </div>
  <label class="sr" for="ask-text">{title}</label>
  <textarea id="ask-text" bind:value={text} rows="3" {placeholder}></textarea>
  <div class="row">
    {#if canResume}
      <label class="check"><input type="checkbox" bind:checked={resume} /> Continue the last conversation</label>
    {/if}
    <span class="go">
      <button type="button" class="btn-ghost" disabled={!ready} onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" class="btn" disabled={!ready || !termOk || !terminal.codex} onclick={() => start('codex')}>Codex</button>
      <button class="btn btn-primary" disabled={!ready || !termOk || !terminal.claude}>Talk to Claude</button>
    </span>
  </div>
  {#if !termOk}
    <p class="meta">The terminal is off: copy the text and send it to Claude on claude.ai or your phone (Code → this assistant).</p>
  {:else if !terminal.claude && !terminal.codex}
    <p class="meta">Sign in to Claude Code or Codex in the <a href="/settings/terminal">terminal</a> first.</p>
  {:else}
    <p class="meta">Opens the terminal. You can also say it to Claude on claude.ai or your phone (Code → this assistant).</p>
  {/if}
</form>

<style>
  .ask {
    display: grid;
    gap: var(--space-3);
  }
  .who {
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
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .go {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }
  .check {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    font-size: 0.875rem;
    color: var(--ink-2);
  }
  .meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
