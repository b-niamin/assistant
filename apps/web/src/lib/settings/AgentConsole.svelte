<script lang="ts">
  /**
   * Claude Code (or Codex) running in an embedded terminal, in its own tmux session: the conversation
   * keeps going when you leave the page and come back. Used by "Extend the system" (new apps, in the
   * repo) and by every extension's settings (in that extension's folder).
   */
  import Mascot from '#lib/Mascot.svelte';
  import TerminalWindow from '#lib/terminal/TerminalWindow.svelte';

  let {
    title,
    session,
    dir = '',
    terminal
  }: {
    title: string;
    /** tmux session prefix; the tool is appended (`<session>-claude`, `<session>-codex`). */
    session: string;
    dir?: string;
    terminal: { configured: boolean; reachable: boolean; claude: boolean; codex: boolean };
  } = $props();

  let tool = $state<'claude' | 'codex'>('claude');
  let win = $state<TerminalWindow>();
  let phase = $state<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  let box: HTMLElement;

  /** Send a message to the agent, as if typed. */
  export function say(text: string) {
    box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    win?.say(text);
  }
</script>

<section class="console" bind:this={box}>
  <div class="top">
    <Mascot mood="steady" size={40} decorative />
    <strong>{title}</strong>
    <div class="tabs" role="tablist" aria-label="Agent">
      <button type="button" role="tab" aria-selected={tool === 'claude'} class:on={tool === 'claude'} onclick={() => (tool = 'claude')}>Claude</button>
      <button type="button" role="tab" aria-selected={tool === 'codex'} class:on={tool === 'codex'} onclick={() => (tool = 'codex')}>Codex</button>
    </div>
  </div>
  {#if !terminal[tool] && phase === 'open'}
    <p class="meta">Not signed in yet: type <code>/login</code> below{tool === 'codex' ? ' (or run codex login in the terminal)' : ''}.</p>
  {/if}
  {#key tool}
    <TerminalWindow
      bind:this={win}
      bind:phase
      configured={terminal.configured}
      reachable={terminal.reachable}
      session="{session}-{tool}"
      start={tool}
      {dir}
      title={tool === 'claude' ? 'Claude Code' : 'Codex'}
      height="min(62vh, 560px)"
      compact
    />
  {/key}
  <p class="meta">Same conversation from your phone: claude.ai → Code → this assistant.</p>
</section>

<style>
  .console {
    display: grid;
    gap: var(--space-2);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tabs {
    margin-left: auto;
    display: inline-flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .tabs button {
    border: 0;
    background: none;
    padding: 4px 14px;
    border-radius: 999px;
    font: inherit;
    font-size: 0.875rem;
    color: var(--ink-2);
    cursor: pointer;
  }
  .tabs button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
  }
  .meta {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--ink-2);
  }
</style>
