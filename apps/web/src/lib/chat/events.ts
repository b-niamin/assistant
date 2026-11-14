/**
 * The chat page's view of a conversation, built from the terminal's chat events (services/terminal/chat.mjs).
 * Pure, so the tests can feed it a recorded stream.
 */
export interface Question {
  question: string;
  header: string;
  multi: boolean;
  options: { label: string; description: string }[];
}

export type ChatEvent =
  | { t: 'user' | 'text' | 'error'; text: string; n?: number }
  | { t: 'tool'; id: string; name: string; summary: string; n?: number }
  | { t: 'result'; id: string; error: boolean; text: string; n?: number }
  | { t: 'ask'; rid: string; tool: string; summary: string; reason?: string; questions?: Question[]; n?: number }
  | { t: 'answer'; rid: string; allow: boolean; answers?: Record<string, string>; n?: number }
  | { t: 'expired'; rid: string; n?: number }
  | { t: 'done'; cost: number | null; ms?: number | null; n?: number }
  | { t: 'delta'; text: string }
  | { t: 'state'; busy: boolean };

export type Item =
  | { kind: 'user' | 'text' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; summary: string; result?: { error: boolean; text: string } }
  | {
      kind: 'ask';
      rid: string;
      tool: string;
      summary: string;
      reason: string;
      questions?: Question[];
      state: 'open' | 'allowed' | 'denied' | 'expired';
      answers?: Record<string, string>;
    };

export interface View {
  items: Item[];
  /** Text Claude is writing right now (deltas), until its message arrives whole. */
  live: string;
  busy: boolean;
  /** The next event number to ask the stream for after a reconnect. */
  next: number;
}

export const emptyView = (): View => ({ items: [], live: '', busy: false, next: 0 });

/** Tools whose call and result the chat shows in another way (the question card). */
const QUIET = new Set(['AskUserQuestion']);

export function apply(view: View, e: ChatEvent): View {
  if ('n' in e && typeof e.n === 'number') {
    if (e.n < view.next) return view;
    view.next = e.n + 1;
  }
  switch (e.t) {
    case 'delta':
      view.live += e.text;
      break;
    case 'state':
      view.busy = e.busy;
      if (!e.busy) view.live = '';
      break;
    case 'user':
      view.items.push({ kind: 'user', text: e.text });
      view.busy = true;
      break;
    case 'text':
      view.live = '';
      view.items.push({ kind: 'text', text: e.text });
      break;
    case 'error':
      view.items.push({ kind: 'error', text: e.text });
      break;
    case 'tool':
      view.live = '';
      if (!QUIET.has(e.name)) view.items.push({ kind: 'tool', id: e.id, name: e.name, summary: e.summary });
      break;
    case 'result': {
      const tool = view.items.find((i) => i.kind === 'tool' && i.id === e.id);
      if (tool?.kind === 'tool') tool.result = { error: e.error, text: e.text };
      break;
    }
    case 'ask':
      view.items.push({ kind: 'ask', rid: e.rid, tool: e.tool, summary: e.summary, reason: e.reason ?? '', questions: e.questions, state: 'open' });
      break;
    case 'answer':
    case 'expired': {
      const ask = view.items.find((i) => i.kind === 'ask' && i.rid === e.rid);
      if (ask?.kind === 'ask' && ask.state === 'open') {
        ask.state = e.t === 'expired' ? 'expired' : e.allow ? 'allowed' : 'denied';
        if (e.t === 'answer' && e.answers) ask.answers = e.answers;
      }
      break;
    }
    case 'done':
      view.live = '';
      view.busy = false;
      break;
  }
  return view;
}

/** Cards still waiting for the owner. */
export const openAsks = (view: View) => view.items.filter((i) => i.kind === 'ask' && i.state === 'open').length;
