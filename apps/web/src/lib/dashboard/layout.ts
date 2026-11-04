/** Per-profile dashboard layout (spec 003): order and hidden tiles, applied to the default tile list. */
export interface LayoutRow {
  tile_key: string;
  position: number;
  hidden: boolean;
}

/**
 * Sort tiles by the saved positions; tiles without a row (new extensions) keep their default order
 * after the placed ones. Returns all tiles with a `hidden` flag, so the editor can show them too.
 */
export function applyLayout<T extends { key: string }>(tiles: T[], rows: LayoutRow[]): (T & { hidden: boolean })[] {
  const byKey = new Map(rows.map((r) => [r.tile_key, r]));
  return tiles
    .map((t, i) => {
      const r = byKey.get(t.key);
      return { t: { ...t, hidden: r?.hidden ?? false }, placed: r ? 0 : 1, pos: r ? r.position : i };
    })
    .sort((a, b) => a.placed - b.placed || a.pos - b.pos)
    .map((x) => x.t);
}

const KEY_RE = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,40}$/;

/** Parse the editor's form: `order` = tile keys in order, `hidden` = keys to hide. */
export function parseLayout(order: string[], hidden: string[]): LayoutRow[] {
  const hide = new Set(hidden);
  const seen = new Set<string>();
  const out: LayoutRow[] = [];
  for (const key of order.slice(0, 200)) {
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ tile_key: key, position: out.length, hidden: hide.has(key) });
  }
  return out;
}
