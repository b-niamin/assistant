/**
 * Key-value storage the shell gives every extension (core.extension_kv). Onefile apps reach it through
 * their localStorage shim; native extensions through ctx.kv (handy for settings).
 * profile scope -> rows keyed by the viewing profile; shared scope -> profile_id IS NULL.
 */
import { db } from '#lib/server/db.ts';
import type { ExtensionInfo } from './types';

export const MAX_VALUE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export interface KvPatch {
  set?: Record<string, string>;
  remove?: string[];
  clear?: boolean;
  /**
   * The version of each key the writer last saw (0 = it did not exist). A key here whose stored version
   * differs makes the whole patch fail with KvConflict. Keys left out are written whatever their version.
   */
  base?: Record<string, number>;
}

/** Versions of the keys a patch wrote or removed (removed = 0). */
export type KvVersions = Record<string, number>;

export class KvConflict extends Error {
  constructor(public keys: string[]) {
    super(`changed elsewhere since it was loaded: ${keys.slice(0, 5).join(', ')}`);
  }
}

const owner = (ext: ExtensionInfo, profileId: string): string | null => (ext.scope === 'shared' ? null : profileId);

/** Every key with its value and version (the onefile page hands the versions to its host). */
export async function kvAllVersioned(ext: ExtensionInfo, profileId: string): Promise<{ data: Record<string, string>; versions: KvVersions }> {
  const rows = await db()<{ key: string; value: string; version: string }[]>`
    SELECT key, value, version FROM core.extension_kv
    WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${owner(ext, profileId)}
    ORDER BY key`;
  return {
    data: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    versions: Object.fromEntries(rows.map((r) => [r.key, Number(r.version)]))
  };
}

export async function kvAll(ext: ExtensionInfo, profileId: string): Promise<Record<string, string>> {
  const rows = await db()<{ key: string; value: string }[]>`
    SELECT key, value FROM core.extension_kv
    WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${owner(ext, profileId)}
    ORDER BY key`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function validatePatch(p: unknown): KvPatch {
  if (!p || typeof p !== 'object') throw new Error('patch must be an object');
  const patch = p as KvPatch;
  if (patch.set !== undefined) {
    if (typeof patch.set !== 'object' || patch.set === null) throw new Error('set must be an object');
    for (const [k, v] of Object.entries(patch.set)) {
      if (typeof v !== 'string') throw new Error(`value of ${k} must be a string`);
      if (k.length > 512) throw new Error('key too long');
      if (Buffer.byteLength(v) > MAX_VALUE_BYTES) throw new Error(`value of ${k} is over 5 MB`);
    }
  }
  if (patch.remove !== undefined && !(Array.isArray(patch.remove) && patch.remove.every((k) => typeof k === 'string')))
    throw new Error('remove must be a list of keys');
  if (patch.base !== undefined) {
    if (typeof patch.base !== 'object' || patch.base === null) throw new Error('base must be an object');
    for (const v of Object.values(patch.base)) if (!Number.isSafeInteger(v) || v < 0) throw new Error('base versions must be whole numbers');
  }
  return patch;
}

export async function kvApply(ext: ExtensionInfo, profileId: string, patch: KvPatch): Promise<KvVersions> {
  const who = owner(ext, profileId);
  const out: KvVersions = {};
  await db().begin(async (sql) => {
    const base = patch.base ?? {};
    const checked = Object.keys(base);
    if (checked.length) {
      const rows = await sql<{ key: string; version: string }[]>`
        SELECT key, version FROM core.extension_kv
        WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${who} AND key = ANY(${checked})
        FOR UPDATE`;
      const now = new Map(rows.map((r) => [r.key, Number(r.version)]));
      const stale = checked.filter((k) => (now.get(k) ?? 0) !== base[k]);
      if (stale.length) throw new KvConflict(stale);
    }
    if (patch.clear)
      await sql`DELETE FROM core.extension_kv WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${who}`;
    for (const key of patch.remove ?? []) {
      await sql`DELETE FROM core.extension_kv
                WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${who} AND key = ${key}`;
      out[key] = 0;
    }
    for (const [key, value] of Object.entries(patch.set ?? {})) {
      const [row] = await sql<{ version: string }[]>`
        INSERT INTO core.extension_kv (extension_id, profile_id, key, value)
        VALUES (${ext.id}, ${who}, ${key}, ${value})
        ON CONFLICT (extension_id, profile_id, key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = core.extension_kv.version + 1
        RETURNING version`;
      out[key] = Number(row.version);
    }
    const [{ total }] = await sql<{ total: number }[]>`
      SELECT COALESCE(sum(octet_length(key) + octet_length(value)), 0)::bigint AS total FROM core.extension_kv
      WHERE extension_id = ${ext.id} AND profile_id IS NOT DISTINCT FROM ${who}`;
    if (Number(total) > MAX_TOTAL_BYTES) throw new Error('storage quota (20 MB) exceeded');
  });
  return out;
}
