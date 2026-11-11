import { agentCommand, shellQuote, type Agent } from '#lib/settings/guide.ts';

/**
 * The dock at the bottom of every page (Dock.svelte): the one terminal in the app. Pages hand it work;
 * it opens and does it once the terminal is connected. The Remote menu in the header
 * (RemoteMenu.svelte) reads the same status from `GET /dock`.
 */
export type DockItem = { run: string; type?: undefined } | { type: string; run?: undefined };
export type Remote = 'starting' | 'running' | 'restarting' | 'signed-out' | 'off';
export interface DockStatus {
  configured: boolean;
  reachable: boolean;
  unlocked: boolean;
  claude: boolean;
  codex: boolean;
  gh: boolean;
  reasons?: { claude: string; codex: string };
  remote: { claude: Remote; codex: Remote };
  background: { claude: boolean; codex: boolean };
  outdated: boolean;
  defaultAgent?: Agent;
  update: { state: string; sha: string; actions: string; step: number; steps: number; pendingRestart: string } | null;
}

export const dock = $state({ open: false, queue: [] as DockItem[], status: null as DockStatus | null });

/** Reload the terminal and Remote Control status; keeps the last known one while the app restarts. */
export async function refreshDock() {
  try {
    const res = await fetch('/dock', { cache: 'no-store' });
    if (res.ok) dock.status = await res.json();
  } catch {
    /* the app is restarting: keep the last known state */
  }
}

/** Open the dock and run a command in a new tmux window, without disturbing what already runs there. */
export function runInDock(cmd: string) {
  dock.queue = [...dock.queue, { run: cmd }];
  dock.open = true;
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
