/**
 * The shell's own MCP tools besides `extensions` (spec 005): `versions` (what runs and what the repos
 * have) and `update_extensions` (the same as "Update" / "Update all" in System settings -> Apps). Pure,
 * unit-tested: what to report and what to update; system.server.ts reads the inputs and starts the chat.
 */
import { compareVersions, type ExtUpdate, type ExtUpdates } from '#lib/settings/ext-updates.ts';

export type ExtVersionState = 'current' | 'update' | 'needs_core' | 'not_in_catalog' | 'unknown';

export interface ExtVersion {
  id: string;
  name: string;
  installed: string;
  /** Version in the extensions repo; null when the repo does not have it (built here) or was not read. */
  available: string | null;
  /** The shell API that version needs, when the catalog says. */
  shell: number | null;
  state: ExtVersionState;
}

export interface CoreVersion {
  /** Commit of the core that runs ('' when the host's updater has not reported one). */
  running: string;
  /** Newest commit on the branch the updater follows; null when GitHub did not answer. */
  latest: string | null;
  branch: string;
  update_available: boolean | null;
  /** The host's updater: ok, available, updating, failed, blocked, or none when it never reported. */
  updater: string;
  shell_api: number;
}

export function extensionVersions(
  installed: { id: string; name: string; version: string }[],
  catalog: { id: string; version?: string; shell?: number }[] | null,
  updates: ExtUpdates
): ExtVersion[] {
  const byId = new Map((catalog ?? []).map((c) => [c.id, c]));
  const ready = new Set(updates.ready.map((u) => u.id));
  const waiting = new Set(updates.waiting.map((u) => u.id));
  return installed.map((e) => {
    const c = byId.get(e.id);
    const state: ExtVersionState = ready.has(e.id)
      ? 'update'
      : waiting.has(e.id)
        ? 'needs_core'
        : catalog === null
          ? 'unknown'
          : !c
            ? 'not_in_catalog'
            : c.version && compareVersions(c.version, e.version) <= 0
              ? 'current'
              : 'unknown';
    return { id: e.id, name: e.name, installed: e.version, available: c?.version ?? null, shell: c?.shell ?? null, state };
  });
}

export function coreVersion(
  status: { sha: string; deployedSha: string; branch: string; status: string } | null,
  latest: string | null,
  shellApi: number
): CoreVersion {
  const running = status?.deployedSha || status?.sha || '';
  return {
    running: running.slice(0, 12),
    latest: latest ? latest.slice(0, 12) : null,
    branch: status?.branch || 'main',
    update_available: running && latest ? !latest.startsWith(running) && !running.startsWith(latest) : null,
    updater: status?.status ?? 'none',
    shell_api: shellApi
  };
}

/**
 * Which updates a call asks for: the named extensions, or every one this core can take. Throws with a
 * message for the AI when a named one has no update, or needs a newer core first.
 */
export function pickUpdates(updates: ExtUpdates, ids: string[] | undefined): ExtUpdate[] {
  if (!ids || !ids.length) {
    if (!updates.ready.length)
      throw new Error(
        updates.waiting.length
          ? `No update this core can take: ${updates.waiting.map((u) => u.id).join(', ')} need a newer core first (System settings -> Updates).`
          : 'Every installed extension already has the extensions repo\'s version.'
      );
    return updates.ready;
  }
  const out: ExtUpdate[] = [];
  for (const id of [...new Set(ids)]) {
    const u = updates.ready.find((x) => x.id === id);
    if (u) {
      out.push(u);
      continue;
    }
    const w = updates.waiting.find((x) => x.id === id);
    if (w) throw new Error(`${id} ${w.to} needs shell API ${w.shell}, newer than this core: update the core first (System settings -> Updates).`);
    throw new Error(`${id} has no update: it is not installed, not from the extensions repo, or already current (see \`versions\`).`);
  }
  return out;
}

/** What the app's chat is asked, as "Update" in System settings -> Apps asks it, plus where it came from. */
export function mcpUpdatePrompt(base: string, client: string): string {
  return `${base} (Asked through the MCP connector${client ? ` by ${client}` : ''}; the owner confirmed it there.)`;
}
