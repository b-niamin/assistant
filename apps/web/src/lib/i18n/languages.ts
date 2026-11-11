/**
 * Languages the app knows (spec 007). English is the base: every string in the code is English and is
 * its own translation key. System settings -> Language picks which of these the app offers; extensions
 * must ship a translation for each one (i18n/<code>.json), and Claude adds a missing one on install.
 */
export interface LanguageInfo {
  /** ISO 639-1 code, also the name of the translation file. */
  code: string;
  /** The language's own name, as its speakers write it. */
  name: string;
  /** BCP 47 locale for dates and numbers. */
  locale: string;
}

export const BASE_LANG = 'en';

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'cs', name: 'Čeština', locale: 'cs-CZ' },
  { code: 'uk', name: 'Українська', locale: 'uk-UA' }
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const isLanguage = (code: unknown): code is string => typeof code === 'string' && BY_CODE.has(code);
export const languageInfo = (code: string): LanguageInfo => BY_CODE.get(code) ?? BY_CODE.get(BASE_LANG)!;
export const localeOf = (code: string): string => languageInfo(code).locale;

/** The cookie that remembers the language picked in this browser (user menu). */
export const LANG_COOKIE = 'lang';

/** What System settings -> Language stores (core.app_settings, key "languages"). */
export type LanguageSettings = {
  /** Languages the app offers and every extension must be translated into; always includes English. */
  enabled: string[];
  /** The language of a browser that has not picked one in the user menu. */
  default: string;
};

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = { enabled: [BASE_LANG], default: BASE_LANG };

/** Clean whatever was stored or posted: known codes only, English always on, default among them. */
export function normalizeLanguageSettings(raw: unknown): LanguageSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { enabled?: unknown; default?: unknown };
  const asked = Array.isArray(r.enabled) ? r.enabled.filter(isLanguage) : [];
  // Keep the order of LANGUAGES, so the menu never reshuffles.
  const enabled = LANGUAGES.map((l) => l.code).filter((c) => c === BASE_LANG || asked.includes(c));
  const def = isLanguage(r.default) && enabled.includes(r.default) ? r.default : BASE_LANG;
  return { enabled, default: def };
}

/** The language of one request: this browser's pick (cookie) if it is still offered, else the default. */
export function pickLanguage(settings: LanguageSettings, cookie: string | undefined): string {
  return cookie && settings.enabled.includes(cookie) ? cookie : settings.default;
}
