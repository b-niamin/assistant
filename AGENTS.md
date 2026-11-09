# AGENTS.md

Rules for AI agents (Claude Code, Codex, ...) and humans working in this repo. Read before changing anything.

## What this is

A private, self-hosted assistant, built from modules. It runs 24/7 under Docker Compose on one
machine. You usually run INSIDE that stack (the `llm` container), reached through Remote Control:
the checkout you edit at `/workspace` is the code that is running.

Architecture: [specs/000-architecture.md](specs/000-architecture.md). The app is a **shell with installable
extensions**: [specs/002-extensions.md](specs/002-extensions.md). To build a new app/area, use the
`new-extension` skill (`.ai/skills/new-extension`).

## Language

Everything in this repo is English: code, comments, docs, specs, commit messages, CLI output.
Answer the owner in the language they write to you in.

## Profiles

There are no user accounts. One app password guards the whole app; data belongs to profiles
(`core.profiles`). **Default profile: `DEFAULT_PROFILE`, else the first profile** (the one made in
`/setup`). Use it unless a request names another one.

## Talking to the extensions (preferred)

Every installed app (extension) is reachable through the `assistant` MCP server (`.mcp.json`,
`scripts/assistant-mcp.mjs`, spec 005). Start with the `extensions` tool; then `<id>__describe` and
`<id>__query` (read-only SQL) for native extensions, `<id>__read_data` / `<id>__write_data` for onefile
apps, plus whatever tools an extension adds (e.g. `health__overview`, `health__add_journal_entry`).
Every tool takes an optional `profile`. Writes go through these tools, never through SQL.

Answering a question that spans apps (e.g. a training plan from health data and the gym tracker) means
reading each extension through its tools. A new kind of data or a result worth keeping (e.g. the plan
itself) becomes a new extension: see the `add-extension` and `new-extension` skills.

## Talking to the data

```sh
psql "$CLAUDE_RO_DATABASE_URL"        # read-only role claude_ro, 30 s statement timeout
```

Each extension's tables live in its own schema (`<id>` with `-` -> `_`); its `AGENTS.md` in
`extensions/<id>/` describes them. Look at raw JSON columns before assuming a field name. Logs: `/logs/`
(`web.log`, `ext-migrate.log`, one per extension service).

## Changing code

1. **Commit every change** with a clear English message. `scripts/hooks/pre-commit` runs the checks;
   never bypass it (`--no-verify` is off-limits). If a change breaks something, `git revert` it.
2. **Migrations are additive**: new numbered file in `db/migrations/`, never edit an applied one, no
   `DROP`/`TRUNCATE`. The `ext-migrate` service applies new ones (shell and extensions) within ~15 s;
   check `/logs/ext-migrate.log`.
3. **A new area is an extension** (`node scripts/ext.mjs new <id>`, see the `new-extension` skill):
   `extensions/<id>/`, its own schema and migrations, role `ext_<id>`. It imports only `$shell` from the
   shell and must not touch other extensions' tables. Ready-made extensions come from the extensions
   repo (`node scripts/ext.mjs available` / `install <id>`); for anything else, a repo or app the owner
   points at is only inspiration (`add-extension` skill). `extensions/` is git-ignored in this repo: it
   is this instance's own state. Its settings live in its panel in
   System settings (manifest `"settings"`). It must wear the app's layout (shell tokens, `specs/001-design.md`)
   and have Beni, the mascot, woven in (`$shell/ui` or `<assistant-beni>` for onefile apps).
4. Edits to `apps/web` and `extensions/` are rebuilt within seconds; a failed build leaves the previous build serving, so check
   `/logs/web.log` for `build ok` after a change. Before committing web changes run
   `cd apps/web && npm test && npm run check`. Edits to
   `docker-compose.yml` or Dockerfiles go live once they are on GitHub `main`: the host's updater
   (spec 006, `scripts/update.sh`) checks main every few minutes and rebuilds or restarts only the
   services whose files changed. It deploys only what is on GitHub, so local commits must be pushed (and
   the checkout must stay on `main` with nothing unpushed, or updates pause). Status: `/logs/updater.log`.

## Never

- Read or print secrets (`.env`, tokens, passwords). Passwords for outside accounts are typed by the
  owner in a terminal only.
- `rm -rf` outside a scratch directory, `git push --force`, rewriting history on `main`.
- Write to the database outside the app's own code paths.
