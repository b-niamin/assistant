---
name: add-extension
description: Add an app (extension) to the assistant from an idea, a repo, an app or a link used as inspiration - Claude builds it fresh in extensions/, adapted to this instance, in the assistant's layout with Beni the mascot, with its settings panel and tools. Use when the owner asks to add, install, connect or set up an app, a data source or an integration.
---

# Adding an extension

The assistant works like a phone: a bare core, apps (extensions) that live side by side, Claude can talk
to each of them, and all their settings are in one place (System settings, one panel per extension).

**Ready-made first.** `node scripts/ext.mjs available` lists the extensions repo. If what the owner
wants is there (health, gym, ...), `node scripts/ext.mjs install <id>` is the whole job: then go to
step 6 (and if it has a `compose.yml`, tell the owner to run `./install.sh` on the host once).

**Any other source is inspiration, never an install.** Whatever the owner points at (their repo, someone else's repo,
an app from onefile-apps, a web page, a screenshot, a sentence), you read it, then build the extension
yourself in `extensions/<id>/`, adapted to this instance. Nothing is cloned or kept in sync
with the source. The owner is the only user and the app is on their tailnet: any source is fine.

## 1. Understand what they want (ask only what you cannot decide)

From the source and their words, settle:
- what it shows, what it stores, where data comes from (an API, a file, another extension's service, manual entry);
- **scope**: per profile (training, learning) or shared (house, family calendar);
- what Claude should be able to ask or change through it (its tools);
- what goes on the dashboard (1-2 numbers or a small chart);
- which **settings** it needs (addresses, units, switches) and which **secrets** (tokens, passwords).

If one of these really changes the result and the source does not answer it, ask the owner one short
question; otherwise pick, build, and say what you picked.

## 2. Read the source

Clone or fetch it into a scratch directory (`/tmp`), never into `extensions/`. Read the README, the data
model and the UI. Note the link: it goes into `inspiredBy`. Do not copy code you have not read.

## 3. Pick the kind

- **onefile**: UI-only, data fits in key-value storage, no network (habit tracker, gym log, flashcards).
  `node scripts/ext.mjs new <id> --from onefile:<appType>/<variant>` starts from an app in onefile-apps.
- **native**: SQL, server-side calls (Home Assistant, a calendar API), data other extensions or Claude
  query, settings or secrets. `node scripts/ext.mjs new <id> --kind native --scope shared` or start from
  a reference: `--from inspiration:home-assistant` (see `inspirations/README.md` in the extensions repo).

Add `--inspired-by "<link or note>"`. Then build it with the `new-extension` skill (layout, `$shell` API,
migrations, checks).

## 4. Make it ours (required)

Every extension wears the assistant's layout and has Beni, the mascot, woven in. The source's own look
(colours, fonts, logo, layout) does not come along: keep what it does, redraw how it looks.

- **Layout and tokens** (`specs/001-design.md`): colours, spacing and radii only from the shell tokens
  (`--page`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--ring`, `--accent`,
  `--hue-*`, `--space-1..7`, `--radius`), light and dark. One system sans, `h1` page title, content in
  `.card`s, buttons `.btn` / `.btn-primary`, statuses as dot plus word, charts by the dataviz rules.
  No UI libraries, no web fonts, no raw hex.
- **Beni**: at least in the page header and in every empty or error state, with a fitting mood (`idle`
  no data yet, `steady` normal, `charged` a goal hit or a good day, `tired` something is off, `asleep`
  closed or paused). Where it fits, let Beni say one short line, like on the dashboard. Give Beni the
  accessory that fits the app in `extension.json` (`"accessory": "book"`, list in `specs/001-design.md`):
  the shell then dresses every Beni on its pages; use `party-hat` for a record or a goal hit.
- **native**: `import { Mascot, moodFor, moodForHour, countUp } from '$shell/ui'`; the shell's classes
  and tokens are already on the page.
- **onefile**: inside the shell the iframe gets the tokens injected (as `@layer assistant`) and a
  `<assistant-beni mood="steady" size="40">` element. Use `var(--page, <fallback>)` so the file still works
  on its own, and drop the app's own palette and fonts.
- `node scripts/ext.mjs check <id>` prints `look:` warnings; a new extension leaves it with none.

## 5. Make it a good citizen

- **Settings panel**: declare its fields in `extension.json` `"settings"`: `text`, `number`, `boolean`,
  `select` (with `options`), `secret`; each with `label`, optional `help` and `default`. The shell draws
  the panel at System settings -> <name>; code reads `ctx.settings.get(name)` and `ctx.secrets.get(name)`;
  a onefile app gets `window.assistantSettings`. An extra view, if fields are not enough:
  `web/routes/settings/+page.svelte` (linked from its panel).
- **Tools for Claude**: the shell gives `describe`/`query` (native) and `read_data`/`write_data` (onefile).
  Add `web/tools.server.ts` for a ready-made overview and for every write (spec 005).
- **Dashboard**: `web/tiles.server.ts` (spec 003).
- **Data stays its own**: its own schema; never read another extension's tables (go through Claude).

## 6. Check and hand over

1. `node scripts/ext.mjs check <id>` (no `look:` warnings) and `cd apps/web && npm test && npm run check`.
   Open `/<id>` in light and dark: it must look like the rest of the app, with Beni.
2. Migrations apply by themselves within ~15 s (`/logs/ext-migrate.log`); the web app rebuilds
   (`build ok` in `/logs/web.log`).
3. Call the `assistant` MCP server: `extensions` lists it and one of its tools answers.
4. Nothing to commit for the extension itself: `extensions/` is this instance's state, git-ignored in the
   core repo. Commit only shell changes you made. To share it, offer to copy it into the extensions repo.
5. Tell the owner, in their language: what it does, where to open it, and what to fill in its panel (System settings
   -> <name>), especially secrets, which they type there themselves. Never ask for a secret in chat.

## Changing or removing

Change it in place like any code (an installed one: `ext update <id>` takes the repo's version and
replaces local edits, keeping the old folder in `extensions/.trash/`). `node scripts/ext.mjs remove <id>` moves the folder to
`extensions/.trash/` and takes it off the list; its data stays in the database.
