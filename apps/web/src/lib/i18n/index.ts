/**
 * The app's languages (spec 007). Shell code, client and server:
 *
 *   const t = useT();          // in a component (shell or extension), during init
 *   tFor(lang)('Save')         // anywhere else, e.g. in a form action with event.locals.lang
 *
 * Shell translations: src/lib/i18n/locales/<lang>.json. An extension's: extensions/<id>/i18n/<lang>.json,
 * compiled in by the generator (generated/i18n.ts); inside an extension's pages useT() reads that file
 * first, then the shell's.
 */
import { getContext, setContext } from 'svelte';
import { EXTENSION_MESSAGES } from '#lib/extensions/generated/i18n.ts';
import type { ExtensionInfo, SettingField } from '#lib/extensions/types.ts';
import { BASE_LANG, localeOf } from './languages';
import { makeT, type Messages, type Translate } from './translate';

export * from './languages';
export { makeT, interpolate, type Messages, type Params, type PluralForms, type Translate } from './translate';

const files = import.meta.glob<Messages>('./locales/*.json', { eager: true, import: 'default' });
/** The shell's own translations by language code. */
export const SHELL_MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries(files).map(([file, messages]) => [file.replace(/^.*\/(\w+)\.json$/, '$1'), messages])
);

const cache = new Map<string, Translate>();

/** The translate function for a language, for the shell or (with its id) for one extension. */
export function tFor(lang: string, extensionId?: string): Translate {
  const key = `${lang}:${extensionId ?? ''}`;
  let t = cache.get(key);
  if (!t) {
    t = makeT(lang, extensionId ? EXTENSION_MESSAGES[extensionId]?.[lang] : undefined, SHELL_MESSAGES[lang]);
    cache.set(key, t);
  }
  return t;
}

/** An extension's name, description and settings labels in a language (its i18n/<lang>.json). */
export function localizeExtension<T extends Pick<ExtensionInfo, 'id' | 'name' | 'description'> & { settings?: SettingField[] }>(
  ext: T,
  lang: string
): T {
  if (lang === BASE_LANG) return ext;
  const t = tFor(lang, ext.id);
  return {
    ...ext,
    name: t(ext.name),
    description: t(ext.description),
    ...(ext.settings
      ? { settings: ext.settings.map((f) => ({ ...f, label: t(f.label), ...(f.help ? { help: t(f.help) } : {}) })) }
      : {})
  };
}

const LANG_KEY = Symbol('assistant-lang');
const EXT_KEY = Symbol('assistant-extension');

/** Root layout: the language of the page (layout data, so it changes with it). */
export function provideLanguage(get: () => string): void {
  setContext(LANG_KEY, get);
}

/** Generated route stubs: the pages below belong to this extension, so useT() reads its file first. */
export function provideExtension(id: string): void {
  setContext(EXT_KEY, id);
}

/** The translate function for the component being initialised. */
export function useT(): Translate {
  const getLang = getContext<(() => string) | undefined>(LANG_KEY) ?? (() => BASE_LANG);
  const ext = getContext<string | undefined>(EXT_KEY);
  const current = () => tFor(getLang(), ext);
  const t = ((text: string, params?: Parameters<Translate>[1]) => current()(text, params)) as Translate;
  t.n = (count, one, other, params) => current().n(count, one, other, params);
  Object.defineProperty(t, 'lang', { get: () => getLang() });
  Object.defineProperty(t, 'locale', { get: () => localeOf(getLang()) });
  return t;
}
