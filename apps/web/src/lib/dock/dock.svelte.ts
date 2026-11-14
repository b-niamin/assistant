import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { chatHandoff } from '#lib/chat/handoff.svelte.ts';
import { chatPanel, openChat } from '#lib/chat/panel.svelte.ts';
import { agentCommand, shellQuote, type Agent } from '#lib/settings/guide.ts';

/**
 * The dock at the bottom of every page (Dock.svelte): the one terminal in the app. It is there only while
 * the session is unlocked, which the lock in the header (LockMenu.svelte) shows and switches. Pages hand
 * the dock work; it opens and does it once the terminal is connected. Both read the status from `GET /dock`.
 *
 * The chat (the panel on the right, lib/chat) is the way to work with Claude; the terminal is the backup. Its bar shows only when
 * the owner turned it on in the user menu ("Turn on the terminal", the `terminal` cookie), or once a page
 * hands it a command (Sign in, installing apps...), until the lock.
 */
export type DockItem = { run: string; type?: undefined } | { type: string; run?: undefined };
export interface DockStatus {
  configured: boolean;
  reachable: boolean;
  unlocked: boolean;
  claude: boolean;
  codex: boolean;
  gh: boolean;
  defaultAgent?: Agent;
  update: { state: string; sha: string; actions: string; step: number; steps: number; pendingRestart: string } | null;
}

export const dock = $state({
  open: false,
  queue: [] as DockItem[],
  status: null as DockStatus | null,
  /** The terminal was opened in this page (it stays connected until the lock closes it). */
  started: false,
  /** The owner turned the terminal on in the user menu. */
  enabled: false,
  /** A page handed the terminal work (or opened it) while it is turned off: it shows until the lock. */
  wanted: false,
  /** A page wants the terminal while locked: the header's lock asks for the password. */
  unlockAsked: false,
  /** The last command a page handed over: on its way (the terminal connects first), then running. */
  handoff: null as Handoff | null
});

export interface Handoff {
  cmd: string;
  state: 'waiting' | 'running';
  /** Counts up with every hand-off, so a page can tell its own from a later one. */
  n: number;
}
let handoffs = 0;

/** The session is unlocked (the one unlock of the app: System settings, the chat and the terminal). */
export const unlocked = () => !!dock.status?.unlocked;

/** The dock is there while unlocked (a connected terminal keeps the unlock alive, see refreshDock). */
export const dockShown = () => !!dock.status?.configured && unlocked();

/** The dock's bar is on the page: unlocked, and turned on or wanted by a page. */
export const dockVisible = () => dockShown() && (dock.enabled || dock.wanted || dock.started);

/**
 * Reload the terminal status; keeps the last known one while the app restarts. A connected terminal or the
 * open chat counts as using the app (`?active`), so the unlock does not run out under them. When the server
 * says locked (the idle time ran out, or Lock in another tab), the terminal goes here too.
 */
export async function refreshDock() {
  try {
    const active = dock.started || chatPanel.open;
    const res = await fetch(active ? '/dock?active=1' : '/dock', { cache: 'no-store' });
    if (!res.ok) return;
    const wasUnlocked = !!dock.status?.unlocked;
    dock.status = await res.json();
    if (wasUnlocked && !dock.status?.unlocked) closeDock();
  } catch {
    /* the app is restarting: keep the last known state */
  }
}

/** Unlock without leaving the page (the same unlock as System settings); the page reloads its data. Returns an error (the server's,
 * else `fallback`, already in the page's language), or ''. */
export async function unlockSession(password: string, fallback: string): Promise<string> {
  try {
    const body = new FormData();
    body.set('password', password);
    const res = await fetch('/settings?/unlock', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
    const result = deserialize(await res.text());
    if (result.type !== 'success') return (result.type === 'failure' && (result.data?.error as string)) || fallback;
    if (dock.status) dock.status.unlocked = true;
    else await refreshDock();
    dock.unlockAsked = false;
    if (dock.queue.length) dock.open = true;
    await invalidateAll();
    return '';
  } catch {
    return fallback;
  }
}

/** Lock: the session needs the password again, the terminal disconnects and the dock goes away. */
export async function lockSession() {
  await fetch('/settings?/lock', { method: 'POST', body: new FormData(), headers: { 'x-sveltekit-action': 'true' } }).catch(() => null);
  closeDock();
  if (dock.status) dock.status.unlocked = false;
  await invalidateAll();
}

function closeDock() {
  dock.started = false;
  dock.wanted = false;
  dock.open = false;
  dock.queue = [];
  dock.handoff = null;
}

/**
 * Open the dock and run a command in a new tmux window, without disturbing what already runs there. The
 * dock's bar shows it on its way and then running (dock.handoff); returns its number there.
 */
export function runInDock(cmd: string): number {
  dock.queue = [...dock.queue, { run: cmd }];
  dock.handoff = { cmd, state: 'waiting', n: ++handoffs };
  openDock();
  return handoffs;
}

/** Open the terminal; while locked, the header's lock asks for the password first. */
export function openDock() {
  dock.wanted = true;
  if (dockShown()) dock.open = true;
  else dock.unlockAsked = true;
}

export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' };

/** The default AI CLI (System settings > Terminal), or the other one when only that one is signed in. */
export function pickAgent(status: DockStatus | null = dock.status): Agent {
  const want = status?.defaultAgent ?? 'claude';
  const other: Agent = want === 'claude' ? 'codex' : 'claude';
  return status && !status[want] && status[other] ? other : want;
}

/**
 * Hand a request to the AI: a new chat with Claude (the chat panel) that sends it at once. With Codex as the default
 * AI, Codex starts in a new tmux window with the prompt as its first message (not typed into a bare shell).
 */
export async function askAgent(prompt: string) {
  if (!dock.status) await refreshDock();
  const agent = pickAgent();
  if (agent === 'claude') {
    chatHandoff.ask = prompt;
    openChat('');
  } else runInDock(agentCommand(agent, prompt));
}

/**
 * A draft for the owner to finish: in a new chat's message box (Claude), or typed into Codex's input box in
 * a new tmux window without Enter (scripts/agent-draft.sh waits until the CLI is up, so no key reaches the shell).
 */
export async function draftForAgent(draft: string) {
  if (!dock.status) await refreshDock();
  const agent = pickAgent();
  if (agent === 'claude') {
    chatHandoff.draft = draft;
    openChat('');
  } else runInDock(`sh scripts/agent-draft.sh ${agent} ${shellQuote(draft)}`);
}
