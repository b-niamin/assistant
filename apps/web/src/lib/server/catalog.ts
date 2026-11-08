/**
 * The extensions repo's catalog.json (spec 002): what "Extend the system" offers. Ready-made extensions
 * are installed by `ext install` in the terminal; inspirations are handed to Claude or Codex to build.
 * Read over HTTPS and kept for 10 minutes; nothing from it is executed here.
 */
import * as env from '$app/env/private';
import { isAccessory, type Accessory } from '#lib/mascot.ts';

const ID_RE = /^[a-z][a-z0-9-]*$/;

export interface CatalogExtension {
  id: string;
  name: string;
  description: string;
  kind: 'native' | 'onefile';
  scope: 'profile' | 'shared';
  /** Brings a background service: `./install.sh` on the host starts it. */
  service: boolean;
  needs?: string;
  /** What Beni wears for it (its manifest "accessory"). */
  accessory?: Accessory;
}
export interface CatalogInspiration {
  id: string;
  name: string;
  description: string;
  scope: 'profile' | 'shared';
  idea: string;
  accessory?: Accessory;
}
export interface Catalog {
  extensions: CatalogExtension[];
  inspirations: CatalogInspiration[];
  /** Set when the repo could not be read; the lists are then empty. */
  error?: string;
}

const DEFAULT_URL = 'https://raw.githubusercontent.com/b-niamin/assistant-extensions/main/catalog.json';
const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; catalog: Catalog } | null = null;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const scopeOf = (v: unknown): 'profile' | 'shared' => (v === 'shared' ? 'shared' : 'profile');

/** Keep only well-formed entries: the file comes from another repo. */
export function parseCatalog(raw: unknown): Catalog {
  const o = (raw ?? {}) as { extensions?: unknown; inspirations?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((e) => e && typeof e === 'object' && ID_RE.test(String(e.id ?? '')));
  return {
    extensions: list(o.extensions).slice(0, 50).map((e) => ({
      id: e.id,
      name: str(e.name, 40) || e.id,
      description: str(e.description, 200),
      kind: e.kind === 'onefile' ? 'onefile' : 'native',
      scope: scopeOf(e.scope),
      service: e.service === true,
      ...(str(e.needs, 80) ? { needs: str(e.needs, 80) } : {}),
      ...(isAccessory(e.accessory) ? { accessory: e.accessory } : {})
    })),
    inspirations: list(o.inspirations).slice(0, 50).map((e) => ({
      id: e.id,
      name: str(e.name, 40) || e.id,
      description: str(e.description, 200),
      scope: scopeOf(e.scope),
      idea: str(e.idea, 300) || str(e.description, 300),
      ...(isAccessory(e.accessory) ? { accessory: e.accessory } : {})
    }))
  };
}

export async function catalog(fetchFn: typeof fetch = fetch): Promise<Catalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.catalog;
  const url = env.EXTENSIONS_CATALOG_URL || DEFAULT_URL;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = parseCatalog(await res.json());
    cached = { at: Date.now(), catalog: c };
    return c;
  } catch (e) {
    // Not cached: the next visit tries again.
    return { extensions: [], inspirations: [], error: `Could not read the extensions repo (${(e as Error).message}).` };
  }
}
