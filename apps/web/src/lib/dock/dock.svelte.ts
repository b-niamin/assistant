/**
 * The dock at the bottom of every page (Dock.svelte): the one terminal in the app, plus indicators for
 * the Remote Control sessions. Pages hand it commands; it opens and runs each in a new tmux window.
 */
export const dock = $state({ open: false, queue: [] as string[] });

/** Open the dock and run a command in its terminal, without disturbing what already runs there. */
export function runInDock(cmd: string) {
  dock.queue = [...dock.queue, cmd];
  dock.open = true;
}
