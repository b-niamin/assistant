/**
 * The shell's `versions` and `update_extensions` MCP tools (spec 005), wired to the same sources as System
 * settings -> Apps and -> Updates: the installed manifests, the extensions repo's catalog.json, the host's
 * updater status and GitHub. An update is not run here (the web container mounts extensions/ read-only):
 * like "Update" in Apps, it starts a chat in the app whose AI runs `ext update`, where critical steps
 * still ask the owner.
 */
import { error } from '@sveltejs/kit';
import { allExtensions } from '#lib/extensions/registry.server.ts';
import { catalog } from '#lib/server/catalog.ts';
import { chatTicket, sidecarsConfigured, terminalAddr, terminalStatus } from '#lib/server/sidecars.ts';
import { latestOnGithub, updaterStatus } from '#lib/server/updater.ts';
import { extensionUpdates, type ExtUpdates } from '#lib/settings/ext-updates.ts';
import { updatePrompt } from '#lib/settings/guide.ts';
import { SHELL_API } from '#lib/shell-api.js';
import { coreVersion, extensionVersions, mcpUpdatePrompt, pickUpdates } from './system';

async function state(visible?: (id: string) => boolean) {
  const [installed, cat] = await Promise.all([allExtensions(), catalog()]);
  const exts = installed.filter((e) => !visible || visible(e.id));
  const updates: ExtUpdates = extensionUpdates(exts, cat.extensions, SHELL_API);
  return { exts, cat, updates };
}

/** `versions`: the core and every (visible) installed extension, with what the repos have. */
export async function versions(visible?: (id: string) => boolean) {
  const [{ exts, cat, updates }, status] = await Promise.all([state(visible), updaterStatus()]);
  const latest = status?.repo ? await latestOnGithub(status.repo, status.branch || 'main').catch(() => null) : null;
  return {
    core: coreVersion(status, latest, SHELL_API),
    extensions: extensionVersions(exts, cat.error ? null : cat.extensions, updates),
    updates_ready: updates.ready.map((u) => u.id),
    updates_need_core: updates.waiting.map((u) => u.id),
    ...(cat.error ? { catalog_error: cat.error } : {})
  };
}

/**
 * `update_extensions`: without `confirm`, what it would update; with it, a new chat in the app runs the
 * update. Returns the chat's id so the owner can follow it in the app.
 */
export async function updateExtensions(args: Record<string, unknown>, client: string) {
  const ids = Array.isArray(args.extensions) ? args.extensions.filter((v): v is string => typeof v === 'string' && !!v) : undefined;
  const { updates } = await state();
  const picked = pickUpdates(updates, ids);
  const list = picked.map((u) => ({ id: u.id, name: u.name, from: u.from, to: u.to }));
  if (args.confirm !== true)
    return {
      confirmed: false,
      would_update: list,
      next: 'Show this list to the user and ask them. Only after they agree, call update_extensions again with confirm: true (and the same extensions).'
    };
  if (!sidecarsConfigured()) throw error(503, 'The app has no SIDECAR_TICKET_SECRET, so it cannot reach its chat.');
  const term = await terminalStatus();
  if (!term.reachable || !term.chat) throw error(503, 'The app\'s chat (terminal container) is not running; update from System settings -> Apps later.');
  if (!term.claude) throw error(503, 'Claude Code is not signed in in the app\'s terminal, so its chat cannot run the update.');
  const text = mcpUpdatePrompt(updatePrompt(picked.map((u) => u.id)), client);
  let res: Response;
  try {
    res = await fetch(`http://${terminalAddr()}/chat`, {
      method: 'POST',
      headers: { 'x-ticket': chatTicket('mcp'), 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw error(502, 'The terminal container is not reachable.');
  }
  if (!res.ok) throw error(502, `The app's chat refused the request (HTTP ${res.status}).`);
  const { id } = (await res.json()) as { id?: string };
  console.log(`[mcp] ${new Date().toISOString()} update of ${picked.map((u) => u.id).join(', ')} handed to chat ${id}`);
  return {
    confirmed: true,
    started: list,
    chat: id ?? null,
    next:
      'The app\'s chat is running `ext update` now; the app rebuilds itself in about a minute. If a step needs ' +
      'approval, it shows an Allow/Deny card in that chat in the app. Call `versions` in a minute or two to see the new versions.'
  };
}
