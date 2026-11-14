/**
 * The chat with Claude is a panel that slides in from the right on every page (ChatPanel.svelte, in the
 * root layout), opened by the chat button next to the lock. It keeps its conversation while the owner
 * moves between pages.
 */
export const chatPanel = $state({
  open: false,
  /** Opened at least once: the panel stays mounted from then on, so its stream and draft survive a close. */
  mounted: false,
  /** The conversation shown ('' = a new one). */
  current: ''
});

export function openChat(id?: string) {
  if (id !== undefined) chatPanel.current = id;
  chatPanel.mounted = true;
  chatPanel.open = true;
}

export function closeChat() {
  chatPanel.open = false;
}
