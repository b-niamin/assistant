/**
 * The home dashboard (spec 003): collects the tiles of every extension the profile can see.
 * Each tile's data is a promise that SvelteKit streams to the page, so the grid renders at once with
 * skeletons and a slow or broken extension costs only its own tile.
 */
import { kvAll } from './kv.server';
import { extensionsFor } from './registry.server';
import { contextFor } from './runtime.server';
import { TILE_MODULES } from './generated/tiles.server';
import { normalizeTile, sizeOf, text, type ExtTile, type TileData, type TileSize } from './tiles';
import type { ExtensionInfo } from './types';

export const TILE_TIMEOUT_MS = 2500;
/** Well-known KV key a onefile app may write (through its localStorage shim) to get a live tile. */
export const ONEFILE_TILE_KEY = '__tile';
const MAX_TILES_PER_EXTENSION = 4;

export type TileResult = { ok: true; data: TileData } | { ok: false; reason: 'timeout' | 'error' };

export interface DashboardTile {
  key: string;
  extensionId: string;
  extensionName: string;
  title: string;
  size: TileSize;
  href: string;
  scope: ExtensionInfo['scope'];
  data: Promise<TileResult>;
}

/** Resolve a tile load within the timeout; never rejects. */
export function settle(key: string, run: () => Promise<TileData> | TileData, ms = TILE_TIMEOUT_MS): Promise<TileResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TileResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
  });
  const work = (async (): Promise<TileResult> => {
    try {
      return { ok: true, data: normalizeTile(await run()) };
    } catch (e) {
      console.error(`dashboard: tile ${key} failed:`, e instanceof Error ? e.message : e);
      return { ok: false, reason: 'error' };
    }
  })();
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** A onefile app's tile: whatever it stored under __tile (untrusted JSON), else a plain card. */
async function onefileTile(ext: ExtensionInfo, profileId: string): Promise<TileData> {
  const raw = (await kvAll(ext, profileId))[ONEFILE_TILE_KEY];
  if (raw) {
    try {
      return JSON.parse(raw) as TileData; // normalizeTile clamps it
    } catch {
      /* fall through to the plain card */
    }
  }
  return { empty: { message: ext.description || 'Open the app' } };
}

const ownsPath = (ext: ExtensionInfo, href: string) => href === ext.href || /^[/?#]/.test(href.slice(ext.href.length)) && href.startsWith(ext.href);

async function nativeTiles(ext: ExtensionInfo): Promise<ExtTile[]> {
  const loader = TILE_MODULES[ext.id];
  if (!loader) return [];
  try {
    const mod = await loader();
    return Array.isArray(mod.tiles) ? mod.tiles.slice(0, MAX_TILES_PER_EXTENSION) : [];
  } catch (e) {
    console.error(`dashboard: tiles of ${ext.id} failed to load:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Tiles the shell itself contributes (not an extension). */
function shellTiles(): DashboardTile[] {
  return [
    {
      key: 'shell:terminal',
      extensionId: 'shell',
      extensionName: 'System',
      title: 'Terminal',
      size: 'sm',
      href: '/settings/terminal',
      scope: 'shared',
      data: Promise.resolve({
        ok: true,
        data: {
          empty: {
            message: 'Claude, Codex or a shell, inside the app',
            action: { label: 'Open terminal', href: '/settings/terminal' }
          }
        }
      })
    }
  ];
}

export async function dashboardFor(locals: App.Locals): Promise<DashboardTile[]> {
  const profileId = locals.profileId;
  const exts = (await extensionsFor(profileId)) as ExtensionInfo[];
  const out: DashboardTile[] = [];
  for (const ext of exts) {
    if ((ext as { enabled?: boolean }).enabled === false) continue;
    const base = { extensionId: ext.id, extensionName: ext.name, scope: ext.scope };
    if (ext.kind === 'onefile') {
      out.push({
        ...base,
        key: `${ext.id}:app`,
        title: ext.name,
        size: 'md', // room for the chart an app may send in __tile
        href: ext.href,
        data: settle(`${ext.id}:app`, () => onefileTile(ext, profileId))
      });
      continue;
    }
    const tiles = await nativeTiles(ext);
    if (!tiles.length) {
      out.push({
        ...base,
        key: `${ext.id}:card`,
        title: ext.name,
        size: 'sm',
        href: ext.href,
        data: Promise.resolve({ ok: true, data: { empty: { message: ext.description || 'Open' } } })
      });
      continue;
    }
    const ctx = contextFor(ext.id, { locals });
    ctx.catch(() => {}); // each tile awaits it and reports its own failure
    const seen = new Set<string>();
    for (const t of tiles) {
      if (!t || typeof t.load !== 'function' || !/^[a-z0-9-]{1,40}$/.test(t.id ?? '') || seen.has(t.id)) continue;
      seen.add(t.id);
      const key = `${ext.id}:${t.id}`;
      const data = settle(key, async () => t.load(await ctx)).then((r) =>
        // A tile may deep-link only inside its own extension.
        r.ok && r.data.href && !ownsPath(ext, r.data.href) ? { ...r, data: { ...r.data, href: undefined } } : r
      );
      out.push({
        ...base,
        key,
        title: text(t.title, 40) ?? ext.name,
        size: sizeOf(t.size),
        href: ext.href,
        data
      });
    }
  }
  out.push(...shellTiles());
  return out;
}
