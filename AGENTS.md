# AGENTS.md

Rules for AI agents (Claude Code, Codex, ...) and humans working in this repo. Read before changing anything.

## What this is

A private, self-hosted assistant, built from modules. It runs 24/7 under Docker Compose on one
machine. You usually run INSIDE that stack (the `terminal` container, the shell at the bottom of the app):
the checkout you edit at `/workspace` is the code that is running.

Architecture: [specs/000-architecture.md](specs/000-architecture.md). The app is a **shell with installable
extensions**: [specs/002-extensions.md](specs/002-extensions.md). To build a new app/area, use the
`new-extension` skill (`.ai/skills/new-extension`); reference: [docs/extensions.md](docs/extensions.md).

## Language

Everything in this repo is English: code, comments, docs, specs, commit messages, CLI output.
Answer the owner in the language they write to you in.

The app itself speaks the languages picked in System settings -> Language (spec 007,
[specs/007-languages.md](specs/007-languages.md)). Every text it shows goes through `t('English text')`, and
every extension ships `i18n/<lang>.json` for each of those languages. Installing or building an extension
that lacks one means translating it before handing it over (`node scripts/ext.mjs check <id>` lists the
gaps as `i18n:` warnings; `node scripts/ext.mjs languages` lists them for all).

## Profiles

There are no user accounts. One app password guards the whole app; data belongs to profiles
(`core.profiles`). **Default profile: `DEFAULT_PROFILE`, else the first profile** (the one made in
`/setup`). Use it unless a request names another one.

## Talking to the extensions (preferred)

Every installed app (extension) is reachable through the `assistant` MCP server (`.mcp.json`,
`scripts/assistant-mcp.mjs`, served by the web app at `/mcp`, spec 005); claude.ai reaches the same server
as the Claude connector. Start with the `extensions` tool, then each app's `<id>__overview`; plus
`<id>__describe` and `<id>__query` (read-only SQL) for native extensions, `<id>__read_data` /
`<id>__write_data` for onefile apps, and whatever else an extension adds (e.g. `health__add_journal_entry`).
Every tool takes an optional `profile`. Writes go through these tools, never through SQL.

Answering a question that spans apps (e.g. a training plan from health data and the gym tracker) means
reading each extension through its tools. A new kind of data or a result worth keeping (e.g. the plan
itself) becomes a new extension: see the `add-extension` and `new-extension` skills.

## Talking to the data

```sh
beni-db -c 'SELECT ...'                 # read-only role claude_ro, 30 s statement timeout
beni-db --write -c 'UPDATE ...'         # read-write role agent_rw: rows of core and every extension
```

`agent_rw` cannot change the schema or roles, truncate, or see secrets, sessions or connector tokens.
Prefer an extension's MCP tools for writes it offers; use SQL for what they do not cover.

Each extension's tables live in its own schema (`<id>` with `-` -> `_`); its `AGENTS.md` in
`extensions/<id>/` describes them. Look at raw JSON columns before assuming a field name. Logs: `/logs/`
(`web.log`, `ext-migrate.log`); extension services and jobs log to `/worker/logs/<id>.<unit>.log`
(state in `/worker/status.json`, System settings -> Worker).

## Changing code

1. **Commit every change** with a clear English message. `scripts/hooks/pre-commit` runs the checks;
   never bypass it (`--no-verify` is off-limits). If a change breaks something, `git revert` it.
2. **Migrations are additive**: new numbered file in `db/migrations/` (the next free number after
   `main`'s last one; CI refuses a duplicate or one that sorts earlier), never edit an applied one, no
   `DROP`/`TRUNCATE`. An extension's migrations (`extensions/<id>/db/migrations/`) are applied by
   `ext-migrate` within ~15 s; check `/logs/ext-migrate.log`. The shell's own `db/migrations/` go live only
   from GitHub `main` (the updater rebuilds the migrate image), so a core migration needs a push the owner
   approves.
3. **A new area is an extension** (`node scripts/ext.mjs new <id>`, see the `new-extension` skill):
   `extensions/<id>/`, its own schema and migrations, role `ext_<id>`. It imports only `$shell` from the
   shell and must not touch other extensions' tables. It adds its MCP tools in `web/tools.server.ts`
   (a read-only `overview`, one tool per write, `readOnly` on each; spec 005). Ready-made extensions come from the extensions
   repo (`node scripts/ext.mjs available` / `install <id>`); for anything else, a repo or app the owner
   points at is only inspiration (`add-extension` skill). `extensions/` is git-ignored in this repo: it
   is this instance's own state. Its settings live in its panel in
   System settings (manifest `"settings"`). It must wear the app's layout (shell tokens, `specs/001-design.md`)
   and have Beni, the mascot, woven in (`$shell/ui` or `<assistant-beni>` for onefile apps). It speaks every
   language of the app (spec 007).
4. Edits to `apps/web` and `extensions/` are rebuilt within seconds; a failed build leaves the previous build serving, so check
   `/logs/web.log` for `build ok` after a change. Before committing web changes run
   `cd apps/web && npm test && npm run check`. Edits to
   `docker-compose.yml` or Dockerfiles go live once they are on GitHub `main`: the host's updater
   (spec 006, `scripts/update.sh`) checks main every few minutes and rebuilds or restarts only the
   services whose files changed. It deploys only what is on GitHub, so local commits must be pushed (and
   the checkout must stay on `main` with nothing unpushed, or updates pause). Status: `/logs/updater.log`.

## What needs the owner's approval

You may do everything in the terminal without asking, except critical changes, which the terminal makes
you ask for (Claude Code: `beni-guard.mjs`; Codex: `beni.rules`; list in `docker/terminal/README.md`): a
push that can reach `main`, force pushes and branch deletions, merging a PR, deleting data or changing the
schema in SQL, `git reset --hard`/`clean -f`, `rm -r` outside scratch folders, removing an extension, and
changing your own permission settings. Ask in words first, say what and why, then run it.

## Never

- Read or print secrets (`.env`, tokens, passwords). Passwords for outside accounts are typed by the
  owner in a terminal only.
- `rm -rf` outside a scratch directory, `git push --force`, rewriting history on `main`.
- Change the database schema or roles outside a migration.
