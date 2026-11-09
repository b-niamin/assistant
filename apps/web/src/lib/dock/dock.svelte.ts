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

/** Open the dock and type text where the cursor is (e.g. to Claude), without pressing Enter. */
export function typeInDock(text: string) {
  dock.queue = [...dock.queue, { type: text }];
  dock.open = true;
}
