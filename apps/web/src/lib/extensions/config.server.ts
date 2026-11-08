/**
 * Values of an extension's settings fields (manifest "settings", its panel in System settings).
 * Plain fields live in core.extension_config; secret fields in secrets.extension_secrets
 * (extension-secrets.ts). Code reads them with ctx.settings.get(name) / ctx.secrets.get(name).
 */
import { db } from '#lib/server/db.ts';
import type { ExtensionInfo, SettingField } from './types';

export type SettingValue = string | number | boolean | null;

const plain = (ext: ExtensionInfo) => ext.settings.filter((f) => f.type !== 'secret');

/** Every plain field's value, falling back to its default (or null). */
export async function readSettings(ext: ExtensionInfo): Promise<Record<string, SettingValue>> {
  const fields = plain(ext);
  if (!fields.length) return {};
  const rows = await db()<{ name: string; value: SettingValue }[]>`
    SELECT name, value FROM core.extension_config WHERE extension_id = ${ext.id}`;
  const stored = new Map(rows.map((r) => [r.name, r.value]));
  return Object.fromEntries(fields.map((f) => [f.name, stored.has(f.name) ? stored.get(f.name)! : (f.default ?? null)]));
}

/** Turn one form value into the field's type; throws a readable message on bad input. */
export function coerce(field: SettingField, raw: string | null): SettingValue {
  if (field.type === 'boolean') return raw === 'on' || raw === 'true';
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (field.type === 'number') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error(`${field.label}: not a number`);
    return n;
  }
  if (field.type === 'select' && !(field.options ?? []).includes(v)) throw new Error(`${field.label}: pick one of the options`);
  if (v.length > 2000) throw new Error(`${field.label}: too long`);
  return v;
}

/** Save the plain fields from a settings form. */
export async function saveSettings(ext: ExtensionInfo, form: FormData): Promise<void> {
  const values = plain(ext).map((f) => ({ name: f.name, value: coerce(f, form.get(`field:${f.name}`)?.toString() ?? null) }));
  await db().begin(async (sql) => {
    for (const { name, value } of values) {
      if (value === null) await sql`DELETE FROM core.extension_config WHERE extension_id = ${ext.id} AND name = ${name}`;
      else
        await sql`INSERT INTO core.extension_config (extension_id, name, value) VALUES (${ext.id}, ${name}, ${sql.json(value)})
                  ON CONFLICT (extension_id, name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  });
}
