/**
 * Translation, gettext style (spec 007): the English text in the code is the key, and a language's
 * file maps it to that language. Pure, used on the server and in the browser.
 *
 *   t('Save')                                  -> "Zapisz"
 *   t('Hello, {name}', { name })               -> placeholders in braces
 *   t.n(count, '{n} set', '{n} sets')          -> plural; the key is the plural (other) form, and the
 *                                                 file gives the forms: {"one": ..., "few": ..., "many": ..., "other": ...}
 *
 * A missing translation falls back to the English text, so nothing ever shows a raw key.
 */
import { BASE_LANG, localeOf } from './languages';

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}
/** One language's file: English text -> translation. */
export type Messages = Record<string, string | PluralForms>;
export type Params = Record<string, string | number | null | undefined>;

export interface Translate {
  (text: string, params?: Params): string;
  /** Plural: `{n}` is filled in with count. */
  n(count: number, one: string, other: string, params?: Params): string;
  /** The language code (en, pl, ...). */
  lang: string;
  /** Its BCP 47 locale, for toLocaleString, Intl.DateTimeFormat and friends. */
  locale: string;
}

export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

const rulesCache = new Map<string, Intl.PluralRules>();
function pluralRules(locale: string): Intl.PluralRules {
  let r = rulesCache.get(locale);
  if (!r) rulesCache.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}

/**
 * A translate function for one language. `dicts` are searched in order (an extension's own file first,
 * then the shell's), so an extension can reuse the shell's common words.
 */
export function makeT(lang: string, ...dicts: (Messages | undefined)[]): Translate {
  const locale = localeOf(lang);
  const lookup = (key: string) => {
    if (lang === BASE_LANG) return undefined;
    for (const d of dicts) {
      const v = d?.[key];
      if (v !== undefined && v !== '') return v;
    }
    return undefined;
  };
  const t = ((text: string, params?: Params) => {
    const v = lookup(text);
    return interpolate(typeof v === 'string' ? v : (v?.other ?? text), params);
  }) as Translate;
  t.n = (count, one, other, params) => {
    const all = { n: count, ...params };
    const v = lookup(other);
    if (v && typeof v === 'object') {
      const form = pluralRules(locale).select(count) as keyof PluralForms;
      return interpolate(v[form] ?? v.other, all);
    }
    if (typeof v === 'string') return interpolate(v, all);
    return interpolate(count === 1 ? one : other, all);
  };
  t.lang = lang;
  t.locale = locale;
  return t;
}
