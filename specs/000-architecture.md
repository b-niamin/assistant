# Spec 000: Architecture

Status: **Built** · Extensions: [spec 002](002-extensions.md). Security model, terminal and browser
containers: [spec 004](004-security.md).

## Goal

One private, self-hosted assistant on a machine that runs 24/7 (a NAS or any Linux box with Docker),
built from extensions. Claude reaches the apps' data through one MCP server (spec 005): from claude.ai and
the Claude apps through the Claude connector, or from Claude Code and Codex in the app's own terminal,
where it also evolves the code on request, but cannot break the running app.

## Containers

```
Tailscale Serve  ─► web :3000 (SvelteKit, on 127.0.0.1; tailnet only)
Tailscale Funnel ─► web :3001 (only /mcp and its OAuth; internet, when the Claude connector is on)
                     │
                     ├── db (Postgres 18, internal)
                     │     schemas: core, secrets, ext_query, one per extension
                     │
                     ├── terminal (spec 004: the in-app terminal; Claude Code, Codex, gh, psql; no ports)
                     │     works on the repo checkout, reaches the apps through /mcp
                     ├── browser (spec 004: Chromium for sign-ins, internal network)
                     ├── migrate (one-shot: migrations + roles), ext-migrate (re-applies on change)
                     ├── backup (daily: dump + .env + extensions into BACKUP_DIR)
                     └── worker: the extensions' services and scheduled jobs (e.g. health's garmin-sync)
```

| Container | Does | Access |
|---|---|---|
| `web` | UI for every extension, the MCP server and its OAuth (spec 005) | db as `app_rw` (+ `SET ROLE ext_<id>`) |
| `db` | Postgres, one schema per extension | — |
| `terminal` | the in-app shell: AI CLIs, data chat, code changes | repo (bind mount), db as `claude_ro`, internet; **no** Docker socket, no `.env` |
| `worker` | the extensions' services and scheduled jobs, each extension as its own uid (spec 002) | db as `ext_<id>_svc` per extension (its own schema + `core.profiles`), host `/proc` and `/sys` read-only, internet; **no** Docker socket, no `.env`, no port |

## Repo layout

```
apps/web/                     SvelteKit (Svelte 5) + adapter-node: the shell
  src/lib/sdk/                $shell, the only API extensions import
  scripts/                    extension discovery and route generation, live-reload
extensions/                   installed extensions (git-ignored; `node scripts/ext.mjs install <id>`)
db/migrations/                numbered SQL, additive only
db/roles.sql                  least-privilege roles, re-applied on every migrate
db/extension-role.sql         per-extension roles
docker/terminal/, docker/browser/   images
services/terminal/            in-app terminal sidecar
scripts/                      ext CLI, MCP relay for the terminal's CLIs, updater, hooks
AGENTS.md                     rules for AI agents in this repo (CLAUDE.md points to it)
.ai/skills/                   project skills (.claude/skills and .agents/skills link here)
```

Ready-made extensions live in [assistant-extensions](https://github.com/b-niamin/assistant-extensions).

## Host and access

- Any x86_64/arm64 machine with Docker and Compose. A small NAS works: the memory limits add up to
  about 5 GB at peak (db 1 GB, terminal 2 GB, web 1.5 GB during a build, the rest small).
- Access: over Tailscale. `web` publishes two ports on 127.0.0.1. The app: HTTPS via `tailscale serve`
  (install.sh runs it when Tailscale is there), tailnet only. The MCP listener: via `tailscale funnel`, on
  the internet, only while System settings -> Claude connector is on (the host's updater runs it). Nothing
  else is exposed to the internet or the LAN.

## Auth and profiles

- One app password, set in the first-run wizard (`/setup`, guarded by the one-time `SETUP_TOKEN`) or as
  `APP_PASSWORD_HASH` (`scrypt:<salt>:<hash>`). DB-backed session (`core.sessions`, 30 days) in an
  httpOnly cookie; login limited to 10 attempts per IP per 15 minutes.
- `core.profiles (id, name, created_at)`; the profile is picked in the UI, there are no user accounts.
  The wizard creates the first one. Default profile (Claude's tools, services): `DEFAULT_PROFILE`, else
  the first profile.
- Every per-profile extension table has `profile_id` → `core.profiles(id) ON DELETE CASCADE`.

## Terminal container (where the AI CLIs run)

- Image (`docker/terminal`): Node + Claude Code + Codex + gh + git + psql + python3, non-root user (`HOST_UID`).
- Volumes: the repo checkout (the same files `web` runs), `claude-home` (login state), `/logs`
  read-only. `.env` is shadowed by an empty file.
- Sign in once from System settings -> Terminal (`claude` + `/login`, `codex login`, `gh auth login`).
  The CLIs run only in the dock's shell, started by hand or by the app (Update, Build it, Install); nothing
  keeps them running in the background. From outside, Claude uses the Claude connector instead.
- Data chat: `beni-db` (= `psql "$CLAUDE_RO_DATABASE_URL"`). `claude_ro` has `SELECT` on core and extension schemas,
  `default_transaction_read_only = on`, a 30 s statement timeout, and no access to `secrets` or to an
  extension's `secret_*` tables. The agents in the terminal also write data with `beni-db --write`
  (role `agent_rw`: rows only, no DDL, same exclusions); deletes ask the owner first (spec 004).

## Keeping Claude from breaking things

1. **No Docker socket.** The AI cannot stop, remove or rebuild containers.
2. **Deploy = commit to the checkout.** `web` runs `scripts/live-reload.mjs`: it builds into
   `build-next/` and swaps it into `build/` only after a successful build, so a broken edit never
   replaces the running app. Compose/Dockerfile edits apply only through auto-update (spec 006) or a
   human rebuild.
3. **Every change is a commit.** The pre-commit hook blocks `.env`, `DROP`/`TRUNCATE` in migrations,
   broken shell scripts and failing tests. Undo is `git revert`; with `CLAUDE_GITHUB_TOKEN` set, commits
   are pushed, so history also lives off the machine.
4. **Read-only data access** for conversations. Schema changes go through new migration files.
5. **Daily backups** (dump, `.env`, extensions; 7 days, 4 weeks, 6 months) in `BACKUP_DIR` next to the checkout; `beni.sh restore` brings one back (docs/install.md).
6. **`AGENTS.md` + `.claude/settings.json`**: profile, extension and migration rules, deny rules for
   `.env`, force pushes, `--no-verify`, `docker`.
