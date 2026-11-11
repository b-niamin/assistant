import { deserialize } from '$app/forms';
import { agentCommand, shellQuote, type Agent } from '#lib/settings/guide.ts';

/**
 * The dock at the bottom of every page (Dock.svelte): the one terminal in the app. It is there only while
 * the session is unlocked, which the lock in the header (LockMenu.svelte) shows and switches. Pages hand
 * the dock work; it opens and does it once the terminal is connected. Both read the status from `GET /dock`.
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
  /** A page wants the terminal while locked: the header's lock asks for the password. */
  unlockAsked: false
});

/** The dock shows while unlocked, and stays while its terminal is connected (the unlock runs out after 10 minutes). */
export const dockShown = () => !!dock.status?.configured && (dock.status.unlocked || dock.started);

/** Reload the terminal status; keeps the last known one while the app restarts. */
export async function refreshDock() {
  try {
    const res = await fetch('/dock', { cache: 'no-store' });
    if (res.ok) dock.status = await res.json();
  } catch {
    /* the app is restarting: keep the last known state */
  }
}

/** The same unlock as System settings (10 minutes), without leaving the page. Returns an error (the server's,
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
    return '';
  } catch {
    return fallback;
  }
}

/** Lock: the session needs the password again, the terminal disconnects and the dock goes away. */
export async function lockSession() {
  await fetch('/settings?/lock', { method: 'POST', body: new FormData(), headers: { 'x-sveltekit-action': 'true' } }).catch(() => null);
  dock.started = false;
  dock.open = false;
  dock.queue = [];
  if (dock.status) dock.status.unlocked = false;
}

/** Open the dock and run a command in a new tmux window, without disturbing what already runs there. */
export function runInDock(cmd: string) {
  dock.queue = [...dock.queue, { run: cmd }];
  openDock();
}

/** Open the terminal; while locked, the header's lock asks for the password first. */
export function openDock() {
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

/** Start the AI CLI in a new tmux window with the prompt as its first message (not typed into a bare shell). */
export async function askAgent(prompt: string) {
  if (!dock.status) await refreshDock();
  runInDock(agentCommand(pickAgent(), prompt));
}

/**
 * Start the AI CLI in a new tmux window and type a draft into its input box without Enter, for the owner
 * to finish. scripts/agent-draft.sh waits until the CLI is up, so no key reaches the shell.
 */
export async function draftForAgent(draft: string) {
  if (!dock.status) await refreshDock();
  runInDock(`sh scripts/agent-draft.sh ${pickAgent()} ${shellQuote(draft)}`);
}
