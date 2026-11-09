/**
 * The dock at the bottom of every page (Dock.svelte): the one terminal in the app, plus the Remote
 * Control menu. Pages hand it work; it opens and does it once the terminal is connected.
 */
export type DockItem = { run: string; type?: undefined } | { type: string; run?: undefined };
export const dock = $state({ open: false, queue: [] as DockItem[] });

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
