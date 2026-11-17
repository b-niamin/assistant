<script lang="ts">
  /**
   * A yes/no question before a step that matters (spec 001), an iOS alert: a title, an optional line, and two
   * buttons side by side, "Cancel" and the step itself. Escape, the backdrop and Cancel say no. `danger`
   * paints the step red (remove, discard); `mood` puts Pingo above the title.
   *
   *   let asking = $state(false);
   *   <button onclick={() => (asking = true)}>Finish</button>
   *   <Confirm bind:open={asking} title="Finish the workout?" confirm="Finish" onconfirm={finish} />
   */
  import type { Snippet } from 'svelte';
  import Mascot from '#lib/Mascot.svelte';
  import type { Mood } from '#lib/mascot.ts';
  import { useT } from '#lib/i18n/index.ts';

  let {
    open = $bindable(false),
    title,
    message = '',
    confirm,
    cancel = '',
    danger = false,
    mood,
    onconfirm,
    oncancel,
    children
  }: {
    open?: boolean;
    title: string;
    message?: string;
    /** The label of the yes button: the step, as a verb ("Finish", "Remove"). */
    confirm: string;
    /** The label of the no button; "Cancel" by default. */
    cancel?: string;
    danger?: boolean;
    mood?: Mood;
    onconfirm: () => void;
    oncancel?: () => void;
    /** More than one line: shown under the message. */
    children?: Snippet;
  } = $props();
  const t = useT();
  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let answered = false;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      answered = false;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  function yes() {
    answered = true;
    open = false;
    onconfirm();
  }
  // Every way out that is not "yes" (Cancel, Escape, the backdrop) ends here.
  function closed() {
    open = false;
    if (!answered) oncancel?.();
    answered = false;
  }
</script>

<dialog
  bind:this={dialog}
  class="confirm"
  aria-labelledby="{uid}-t"
  aria-describedby={message ? `${uid}-m` : undefined}
  onclose={closed}
  onclick={(e) => e.target === dialog && dialog?.close()}>
  <div class="box">
    {#if mood}<span class="pip"><Mascot {mood} size={48} decorative /></span>{/if}
    <h2 id="{uid}-t">{title}</h2>
    {#if message}<p id="{uid}-m">{message}</p>{/if}
    {#if children}<div class="more">{@render children()}</div>{/if}
  </div>
  <div class="actions">
    <button type="button" class="plain" onclick={() => dialog?.close()}>{cancel || t('Cancel')}</button>
    <button type="button" class="yes" class:danger onclick={yes}>{confirm}</button>
  </div>
</dialog>

<style>
  .confirm {
    width: min(300px, calc(100vw - 48px));
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-pop);
    text-align: center;
    overflow: hidden;
  }
  .confirm::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
  @media (prefers-reduced-motion: no-preference) {
    .confirm[open] {
      animation: pop 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
  }
  :global([data-motion='reduce']) .confirm[open] {
    animation: none;
  }
  @keyframes pop {
    from {
      transform: scale(1.12);
      opacity: 0;
    }
  }
  .box {
    padding: var(--space-5) var(--space-4) var(--space-4);
  }
  .pip {
    display: inline-flex;
    margin-bottom: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
  }
  p {
    margin: var(--space-1) 0 0;
    color: var(--ink-2);
    font-size: var(--text-sm);
  }
  .more {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--sep);
  }
  .actions button {
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: inherit;
    font-size: var(--text-base);
    cursor: pointer;
  }
  .actions button + button {
    border-left: 1px solid var(--sep);
  }
  .yes {
    font-weight: var(--weight-bold);
  }
  .yes.danger {
    color: var(--critical-ink);
  }
  @media (hover: hover) {
    .actions button:hover {
      background: var(--surface-2);
    }
  }
  .actions button:active {
    background: var(--surface-2);
  }
</style>
