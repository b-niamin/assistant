# Spec 007: Languages

Status: **Implemented** · 2026-11-11

## Goal

The app speaks the owner's language. System settings -> Language picks the languages the app offers and
the default one; every extension is built in all of them, and one that lacks a language is translated
by Claude when it is installed. Each browser can switch between the offered languages in the profile menu.

## Choice

| Option | For | Against |
|---|---|---|
| A library (paraglide, svelte-i18n, i18next) | mature, ICU messages | a dependency and a build step in every extension; message ids instead of readable text |
| Keyed messages (`settings.title`) | stable ids | two edits per text (code + en file), unreadable code |
| **gettext style: the English text is the key** | code reads as before, English needs no file, a missing translation shows English, a script can list what is missing | changing an English text needs the translations renamed |

We use gettext style, about 80 lines, no dependency. Plurals use the language's own rules
(`Intl.PluralRules`), so Polish gets its one/few/many forms.

## How it works

```
apps/web/src/lib/i18n/
  languages.ts          the languages the app knows (code, own name, locale); settings rules
  translate.ts          makeT(lang, ...dicts): t('Text'), t('{n} km', { n }), t.n(count, one, other)
  index.ts              tFor(lang, extensionId?), useT() for components, localizeExtension()
  locales/pl.json       the shell's texts in Polish ("English text": "translation")
extensions/<id>/i18n/pl.json   one extension's texts in Polish
```

- **Which language a page is in**: the browser's pick (cookie `lang`, set in the profile menu) while it is
  still offered, else the default (`hooks.server.ts` -> `locals.lang`, `<html lang>`).
- **Settings**: `core.app_settings` key `languages` = `{ "enabled": ["en", "pl"], "default": "pl" }`
  (migration 009). English is always on: it is the base of every text. The first-run wizard asks for the
  language and enables it next to English.
- **Shell code**: `const t = useT()` in a component; `tFor(locals.lang)` in server code (form errors).
  A test (`i18n.test.ts`) fails when a `t('...')` text of the shell has no entry in a `locales/*.json`.
- **Native extensions**: `useT` from `$shell/ui` in components and `ctx.t` / `ctx.lang` in server code
  (loads, actions, tiles, sources, tools). The generated route stubs tell `useT` which extension a page
  belongs to, so it reads `extensions/<id>/i18n/<lang>.json` first, then the shell's file (common words
  like Save come for free). The generator inlines every extension's files into `generated/i18n.ts`.
  The shell translates an extension's name, description, settings labels and help, select options and
  static tile titles with the same file.
- **Onefile extensions** carry their own translations inside the HTML (onefile-apps are English and
  Polish) and list them in the manifest: `"languages": ["en", "pl"]`. The shell injects
  `window.assistantLang` (and sets `<html lang>`); an app uses it over its own guess. Their name and
  description are translated in `i18n/<lang>.json` like any extension's.
- **Dates and numbers**: `t.locale` (`pl-PL`, `en-GB`) for `toLocaleString`, `Intl.DateTimeFormat`, ...
- **Tools for Claude** stay English: they are read by Claude, not shown in the app.

## Translation files

```json
{
  "Training & Health": "Trening i zdrowie",
  "Last night": "Ostatnia noc",
  "{n} km": "{n} km",
  "{n} runs": { "one": "{n} bieg", "few": "{n} biegi", "many": "{n} biegów", "other": "{n} biegu" }
}
```

Keys are the exact English texts, placeholders included. A plural key is the second (plural) English
form of `t.n(count, '{n} run', '{n} runs')`; its forms are the categories of `Intl.PluralRules` for the
language (`one`, `few`, `many`, `other` for Polish; `one`, `other` for German).

## Claude translates on install

- `ext install` / `ext update` print, after copying, what the extension lacks in the app's languages
  (`ext: i18n: home: no i18n/pl.json (112 texts to translate)`); the `add-extension` skill says to
  translate before handing it over, and `ext check <id>` must print no `i18n:` warnings.
- `ext languages` lists the app's languages and every gap; `ext check` reads the languages from the
  running app (`GET /api/claude`, which also lists each extension's `languages`), or `--languages pl`.
- The keys come from the code (`t('...')`, `t.n(n, '...', '...')`, `title: '...'` in `tiles.server.ts`)
  and from the manifest. Only literal strings are found: a text built at runtime must be a key on its own.
- System settings -> Language shows the apps that lack a language and an "Ask Claude to translate"
  button that starts Claude in the dock's terminal with that request.
- Extensions in the extensions repo ship their translations, so most installs need nothing.
- Its catalog entries may carry `"i18n": {"pl": {"name": "...", "description": "...", "needs": "..."}}` for "Extend the system".

## Adding a language

1. Add it to `LANGUAGES` in `languages.ts` (if not there yet), turn it on in System settings.
2. Shell: `locales/<code>.json` with every key of `locales/pl.json` (the test lists what is missing).
3. Extensions: `ext languages` lists the gaps; Claude translates each.
