/** System settings -> Appearance (spec 001), stored in core.app_settings under "appearance". */
import { db } from './db';
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from '#lib/appearance.ts';

let cached: Promise<Appearance> | null = null;

export function appearance(): Promise<Appearance> {
  if (!cached) {
    cached = db()<{ value: unknown }[]>`SELECT value FROM core.app_settings WHERE key = 'appearance'`
      .then(([row]) => (row ? normalizeAppearance(row.value) : DEFAULT_APPEARANCE))
      .catch(() => {
        cached = null;
        return DEFAULT_APPEARANCE;
      });
  }
  return cached;
}

export async function saveAppearance(raw: unknown): Promise<Appearance> {
  const value = normalizeAppearance(raw);
  await db()`INSERT INTO core.app_settings (key, value) VALUES ('appearance', ${db().json(value as never)})
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  cached = Promise.resolve(value);
  return value;
}
