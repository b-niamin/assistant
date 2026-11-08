# AGENTS.md ({{id}} extension)

This folder is an extension of the assistant shell. Read the shell's `AGENTS.md` and
`specs/002-extensions.md` first. Rules that matter here:

- Import from the shell ONLY `$shell` (types, context) and `$shell/ui` (Beni, motion helpers). Never `$lib` or `#lib`,
  never another extension. `node scripts/ext.mjs check {{id}}` enforces it.
- Server code gets `ctx` as the second argument of `load`, actions and `+server.ts` handlers. Query only
  through `ctx.db(sql => ...)`: it runs as role `ext_{{schema}}`, which sees schema `{{schema}}` and
  `core.profiles`, nothing else.
- This extension's scope is `{{scope}}`. Scope "profile": every table has `profile_id` and every query
  filters by `ctx.dataProfileId`. Scope "shared": one data set for everybody (`ctx.dataProfileId` is null).
- Migrations: new numbered file in `db/migrations/`, additive only, never edit an applied one. The
  `ext-migrate` service applies them within ~15 s (`/logs/ext-migrate.log`).
- Settings: fields in `extension.json` `"settings"` become its panel in System settings; read them with
  `ctx.settings.get(name)` and secrets with `ctx.secrets.get(name)`.
- Tools for Claude: `web/tools.server.ts` (spec 005) for an overview and every write.
- Look (required): the shell's layout and tokens (`.card`, `.btn`, `.muted`, `--ink-*`, `--accent`,
  `--hue-*`, `--space-*`; the shell's `specs/001-design.md`) and Beni (`Mascot` from `$shell/ui`) in the
  header and every empty or error state. No UI libraries, no raw hex.
- Commit it in the assistant repo, with `extensions/installed.json`. Before that, run the
  shell's checks: `cd apps/web && npm test && npm run check`, and look for `build ok` in `/logs/web.log`.
