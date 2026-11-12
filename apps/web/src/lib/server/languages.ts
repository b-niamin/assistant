/** System settings -> Language (spec 007), stored in core.app_settings under "languages". */
import { db } from './db';
import { DEFAULT_LANGUAGE_SETTINGS, normalizeLanguageSettings, type LanguageSettings } from '#lib/i18n/languages.ts';

let cached: Promise<LanguageSettings> | null = null;

export function languageSettings(): Promise<LanguageSettings> {
  if (!cached) {
    cached = db()<{ value: unknown }[]>`SELECT value FROM core.app_settings WHERE key = 'languages'`
      .then(([row]) => (row ? normalizeLanguageSettings(row.value) : DEFAULT_LANGUAGE_SETTINGS))
      .catch((e) => {
        cached = null;
        throw e;
      });
  }
  return cached;
}

export async function saveLanguageSettings(raw: unknown): Promise<LanguageSettings> {
  const value = normalizeLanguageSettings(raw);
  await db()`INSERT INTO core.app_settings (key, value) VALUES ('languages', ${db().json(value)})
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  cached = Promise.resolve(value);
  return value;
}
