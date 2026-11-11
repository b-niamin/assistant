---
name: new-extension
description: Build a new app/extension for the assistant shell (or change one), from a template or from an app in onefile-apps. Use when the owner asks for a new app, module, tool, dashboard or tracker in the assistant.
---

# Building an assistant extension

The assistant is a shell with installable extensions. Read `specs/002-extensions.md` once; this is the
working checklist.

## 1. Pick the kind

- **onefile**: a UI-only tool whose data fits in key-value storage (flashcards, habit tracker, checklist,
  timer, gym log). One HTML file, sandboxed, no network. Check https://github.com/b-niamin/onefile-apps
  first (`catalog.json`): if something close exists, start from it.
- **native**: needs SQL queries, server-side calls (Home Assistant, a calendar API), data that other
  extensions or Claude (through MCP tools) should query, or real sharing between profiles.

Scope: **profile** (each profile has its own data: learning, training) or **shared** (one data set: house,
family calendar). Visibility is separate: `node scripts/ext.mjs profiles <id> alex,sam`.

Ask the owner only if the kind or scope really is unclear; otherwise pick and say which.

## 2. Create

```sh
node scripts/ext.mjs new <id> --kind native  --scope profile --name "Learning"
node scripts/ext.mjs new <id> --kind onefile --scope shared  --name "Shopping list"
node scripts/ext.mjs new <id> --from onefile:habit-tracker/weekly-grid
```

The id is the URL (`/<id>`), the DB schema and the role `ext_<id>`. It creates `extensions/<id>/` in this
repo and adds it to `extensions/installed.json`. Read the new `extensions/<id>/AGENTS.md`. Starting from
something the owner pointed at? Follow the `add-extension` skill: the source is inspiration only.

## 3. Build it

Native:
- Routes in `web/routes/` (SvelteKit names), helpers and tests in `web/lib/`.
- Import from the shell only `$shell` and `$shell/ui`. Server code: `load(event, ctx)`,
  `actions: ExtActions`, queries only via `ctx.db(sql => ...)`, filtered by `ctx.dataProfileId` for scope
  profile.
- Schema changes: `db/migrations/NNN_name.sql`, additive. `ext-migrate` applies them within ~15 s
  (`/logs/ext-migrate.log`).
- Tools for the AI (required, both kinds): `web/tools.server.ts` (`export const tools: ExtTool[]`) with a
  read-only `overview` and one tool per write (validate input; write via `ctx.db`, or `ctx.kv` for a
  onefile app's localStorage), each with `title` and `readOnly: true|false` (`destructive: true` when it
  overwrites or deletes). The templates start one; `ext check` warns without it. Examples (in the
  extensions repo, not necessarily installed here):
  https://github.com/b-niamin/assistant-extensions/blob/main/extensions/health/web/tools.server.ts and
  .../extensions/gym/web/tools.server.ts; spec 005. Reference of the manifest, SDK and classes:
  docs/extensions.md.
- Look (required): the shell's layout and tokens (`specs/001-design.md`) and Beni from `$shell/ui` in the
  header and every empty or error state, and its `"accessory"` in `extension.json` (what Beni wears, list in
  `specs/001-design.md`). No UI libraries, no raw hex. See the `add-extension` skill, step 4.
- Languages (required, spec 007): every shown text through `t()` (`useT()` from `$shell/ui`, `ctx.t` on
  the server) and `i18n/<lang>.json` for each language of the app (System settings -> Language). See the
  `add-extension` skill, step 5.
- Settings and secrets: declare fields in `extension.json` `"settings"` (text, number, boolean, select,
  secret). The shell draws its panel in System settings; read with `ctx.settings.get` / `ctx.secrets.get`.
  Secret values never go in code, KV, chat or the repo: the owner types them in the panel.

Onefile:
- Follow onefile-apps' ARTIFACTS-DEVELOPMENT.md (one file, CSP meta, EN + PL, phone-first, light + dark).
- Look (required): the shell injects its tokens and `<assistant-beni>`; style with `var(--page, <fallback>)`
  and put Beni in the header and empty states, not the app's own palette or fonts.
- Languages (required, spec 007): its own dictionary for every language of the app, `"languages"` in
  `extension.json`, `window.assistantLang` over `navigator.language`; name and description in `i18n/<lang>.json`.
- Keep all state in `localStorage` under a few versioned keys; the shell persists it per scope.

## 4. Check

```sh
node scripts/ext.mjs check <id>   # must print no look: or i18n: warnings
cd apps/web && npm test && npm run check
```

Then wait for `build ok` in `/logs/web.log` and open `/<id>`. A failed build keeps the old one serving.

## 5. Hand over

- `extensions/` is git-ignored (this instance's state): commit only what you changed in the shell.
  An extension worth reusing elsewhere goes into the extensions repo, on request.
- Tell the owner what is pending on them: values to fill in its settings panel. Background work needs
  nothing from them: declare it in the manifest (`services` / `jobs`, spec 002 "Background work") and the
  worker starts it within seconds; check `/worker/status.json` and `/worker/logs/<id>.<unit>.log`. Only
  something the worker cannot run (another image, a device) still needs a `compose.yml` and `./install.sh`.
