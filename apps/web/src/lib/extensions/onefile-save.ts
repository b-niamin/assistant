/**
 * The onefile host's save batches (OnefileHost.svelte): pure, unit-tested. A batch is what the app wrote
 * since the last save: keys set, keys removed, or a clear.
 */
export interface Batch {
  set: Record<string, string>;
  remove: Set<string>;
  clear: boolean;
}

export const freshBatch = (): Batch => ({ set: {}, remove: new Set(), clear: false });
export const isEmpty = (b: Batch): boolean => !b.clear && !b.remove.size && !Object.keys(b.set).length;

/** A failed batch back in front of what the app wrote since: the later writes win. */
export function mergeBatch(older: Batch, newer: Batch): Batch {
  if (newer.clear) return { set: { ...newer.set }, remove: new Set(newer.remove), clear: true };
  const out: Batch = { set: { ...older.set }, remove: new Set(older.remove), clear: older.clear };
  for (const k of newer.remove) {
    delete out.set[k];
    out.remove.add(k);
  }
  for (const [k, v] of Object.entries(newer.set)) {
    out.set[k] = v;
    out.remove.delete(k);
  }
  return out;
}

/** The PATCH body: the batch plus the version the app last saw of each key it touches (0 = new). */
export function batchBody(b: Batch, base: Record<string, number>) {
  const keys = b.clear ? [] : [...Object.keys(b.set), ...b.remove];
  return {
    set: b.set,
    remove: [...b.remove],
    clear: b.clear,
    base: Object.fromEntries(keys.map((k) => [k, base[k] ?? 0]))
  };
}
