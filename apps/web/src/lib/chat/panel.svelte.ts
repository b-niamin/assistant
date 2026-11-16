/**
 * The chat with Claude is a drawer on the right on every page (ChatPanel.svelte, in the root layout), opened
 * by the chat button next to the lock. On a wide screen it pushes the page aside instead of covering it; on a
 * narrow one it covers the page. Its left edge can be dragged to make it wider; the width is remembered in
 * this browser. It keeps its conversation while the owner moves between pages.
 */
export const CHAT_MIN_WIDTH = 340;
export const CHAT_DEFAULT_WIDTH = 460;
/** Below this viewport width the drawer covers the page (a phone, a narrow window) instead of pushing it. */
export const CHAT_PUSH_FROM = 900;
/** What the page keeps at least when the drawer pushes it. */
const PAGE_MIN_WIDTH = 420;
const KEY = 'assistant.chat.width';

export const chatPanel = $state({
  open: false,
  /** Opened at least once: the panel stays mounted from then on, so its stream and draft survive a close. */
  mounted: false,
  /** The conversation shown ('' = a new one). */
  current: '',
  /** The drawer's width in px, as the owner dragged it. */
  width: readWidth(),
  /** Its edge is being dragged: the drawer and the page follow the pointer without easing. */
  resizing: false
});

/**
 * The width kept within what the viewport allows: never narrower than the minimum; beside the page (a wide
 * screen), never leaving the page too little; over it (a narrow one), at most the whole viewport.
 */
export function clampChatWidth(width: number, viewport: number): number {
  const max = viewport >= CHAT_PUSH_FROM ? viewport - PAGE_MIN_WIDTH : viewport;
  return Math.round(Math.min(max, Math.max(CHAT_MIN_WIDTH, width)));
}

function readWidth(): number {
  try {
    if (typeof window === 'undefined') return CHAT_DEFAULT_WIDTH;
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= CHAT_MIN_WIDTH ? n : CHAT_DEFAULT_WIDTH;
  } catch {
    return CHAT_DEFAULT_WIDTH;
  }
}

export function setChatWidth(width: number, save = true) {
  chatPanel.width = Math.round(width);
  if (!save) return;
  try {
    if (typeof window !== 'undefined') localStorage.setItem(KEY, String(chatPanel.width));
  } catch {
    /* private mode: the width lasts this visit only */
  }
}

export function openChat(id?: string) {
  if (id !== undefined) chatPanel.current = id;
  chatPanel.mounted = true;
  chatPanel.open = true;
}

export function closeChat() {
  chatPanel.open = false;
}
