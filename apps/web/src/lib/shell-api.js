/**
 * The SDK contract version (spec 002). It grows by additions only: an extension declares the version it
 * was written for and builds on that core or any newer one. 2 = shared charts, EmptyState, EN, ticks;
 * 3 = `import assistant` for Python services (docker/worker/lib); 4 = `ext-run` in the app's terminal, and a
 * source's `command` run there by its button; 5 = the shared calendar; 6 = the Pingo rename; 7 = Assistant UI
 * (lib/ui.css classes, PageHead/Segmented/Sheet/Icon in $shell/ui, manifest "icon" and "pages"); 8 = Pager.
 * Plain JS in its own file: `ext check` (scripts/extensions-lib.mjs) and the web app (which updates of the
 * installed apps this core can take) read the same number.
 */
export const SHELL_API = 9;
