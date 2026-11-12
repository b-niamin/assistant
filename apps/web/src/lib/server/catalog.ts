/**
 * The extensions repo's catalog.json (spec 002): what "Extend the system" offers. Ready-made extensions
 * are installed by `ext install` in the terminal.
 * Read over HTTPS and kept for 10 minutes; nothing from it is executed here.
 */
import * as env from '$app/env/private';
import { isAccessory, type Accessory } from '#lib/mascot.ts';

import { EXTENSION_ID_RE as ID_RE } from '#lib/ids.js';

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
  /** Name, description and needs in other languages (spec 007): {"pl": {"name": ..., "description": ...}}. */
  i18n?: CatalogTexts;
}
export type CatalogTexts = Record<string, { name?: string; description?: string; needs?: string }>;
export interface Catalog {
  extensions: CatalogExtension[];
  /** Set when the repo could not be read; the lists are then empty. */
  error?: string;
}

const DEFAULT_URL = 'https://raw.githubusercontent.com/b-niamin/assistant-extensions/main/catalog.json';
const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; catalog: Catalog } | null = null;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const scopeOf = (v: unknown): 'profile' | 'shared' => (v === 'shared' ? 'shared' : 'profile');
/** {"pl": {"name", "description"}} with two-letter codes and short strings only. */
function textsOf(v: unknown): { i18n?: CatalogTexts } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: CatalogTexts = {};
  for (const [lang, t] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-z]{2}$/.test(lang) || !t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    out[lang] = {
      ...(str(o.name, 40) ? { name: str(o.name, 40) } : {}),
      ...(str(o.description, 200) ? { description: str(o.description, 200) } : {}),
      ...(str(o.needs, 80) ? { needs: str(o.needs, 80) } : {})
    };
  }
  return Object.keys(out).length ? { i18n: out } : {};
}

/** A catalog entry's name and description in a language, when the catalog has them. */
export function localizeEntry<T extends { name: string; description: string; needs?: string; i18n?: CatalogTexts }>(e: T, lang: string): T {
  const t = e.i18n?.[lang];
  if (!t) return e;
  return { ...e, name: t.name || e.name, description: t.description || e.description, ...(e.needs && t.needs ? { needs: t.needs } : {}) };
}

/** Keep only well-formed entries: the file comes from another repo. */
export function parseCatalog(raw: unknown): Catalog {
  const o = (raw ?? {}) as { extensions?: unknown };
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
      ...(isAccessory(e.accessory) ? { accessory: e.accessory } : {}),
      ...textsOf(e.i18n)
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
    return { extensions: [], error: `Could not read the extensions repo (${(e as Error).message}).` };
  }
}
