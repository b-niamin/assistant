/**
 * Which installed apps have a newer version in the extensions repo (System settings -> Apps, "Update all").
 * Pure, unit-tested: the installed manifests, the repo's catalog.json and this core's SHELL_API in, the
 * updates out. Nothing is updated here: `ext update` does that, run by the AI in the chat.
 */

export interface ExtUpdate {
  id: string;
  name: string;
  /** Installed version. */
  from: string;
  /** Version in the extensions repo. */
  to: string;
  /** The shell API the new version needs. */
  shell: number | null;
}

export interface ExtUpdates {
  /** This core can take them now. */
  ready: ExtUpdate[];
  /** They need a newer core (shell API) first: System settings -> Updates. */
  waiting: ExtUpdate[];
}

/** 1.10.0 > 1.9.3. Anything that is not x.y.z counts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : [0, 0, 0]);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function extensionUpdates(
  installed: { id: string; name: string; version: string }[],
  catalog: { id: string; version?: string; shell?: number }[],
  shellApi: number
): ExtUpdates {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out: ExtUpdates = { ready: [], waiting: [] };
  for (const e of installed) {
    const c = byId.get(e.id);
    if (!c?.version || compareVersions(c.version, e.version) <= 0) continue;
    const u: ExtUpdate = { id: e.id, name: e.name, from: e.version, to: c.version, shell: c.shell ?? null };
    (u.shell !== null && u.shell > shellApi ? out.waiting : out.ready).push(u);
  }
  return out;
}
