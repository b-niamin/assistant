# Spec 000: Architecture

Status: **Built** · Extensions: [spec 002](002-extensions.md). Security model, terminal and browser
containers: [spec 004](004-security.md).

## Goal

One private, self-hosted assistant on a machine that runs 24/7 (a NAS or any Linux box with Docker),
built from extensions. Claude runs in its own container, reached through Remote Control: it talks to the
data and evolves the code on request, but cannot break the running app.

## Containers

```
Tailscale ─► web (SvelteKit, the only published port, on 127.0.0.1)
                     │
                     ├── db (Postgres 16, internal)
                     │     schemas: core, secrets, ext_query, one per extension
                     │
                     ├── claude (Claude Code + git + psql, no ports)
                     │     `claude remote-control` in a restart loop, works on the repo checkout
                     │
                     ├── terminal, browser (spec 004: in-app terminal and Chromium, internal network)
                     ├── migrate (one-shot: migrations + roles), ext-migrate (re-applies on change)
                     ├── backup (daily pg_dump, 14 days kept)
                     └── extension services (each extension's compose.yml, e.g. health's garmin-sync)
```

| Container | Does | Access |
|---|---|---|
| `web` | UI for every extension, REST API, Claude's tools (spec 005) | db as `app_rw` (+ `SET ROLE ext_<id>`) |
| `db` | Postgres, one schema per extension | — |
| `claude` | Remote Control, data chat, code changes | repo (bind mount), db as `claude_ro`, internet; **no** Docker socket, no `.env` |
| extension service | whatever the extension needs in the background | db as `ext_<id>_svc` (its own schema + `core.profiles`) |

## Repo layout

```
apps/web/                     SvelteKit (Svelte 5) + adapter-node: the shell
  src/lib/sdk/                $shell, the only API extensions import
  scripts/                    extension discovery and route generation, live-reload
extensions/                   installed extensions (git-ignored; `node scripts/ext.mjs install <id>`)
db/migrations/                numbered SQL, additive only
db/roles.sql                  least-privilege roles, re-applied on every migrate
db/extension-role.sql         per-extension roles
docker/claude/, docker/browser/   images
services/terminal/            in-app terminal server (runs in the claude container)
scripts/                      ext CLI, MCP server for Claude, auto-update, hooks
AGENTS.md                     rules for AI agents in this repo (CLAUDE.md points to it)
.ai/skills/                   project skills (.claude/skills and .agents/skills link here)
```

Ready-made extensions live in [assistant-extensions](https://github.com/b-niamin/assistant-extensions).

## Host and access

- Any x86_64/arm64 machine with Docker and Compose. A small NAS works: the memory limits add up to
  about 5 GB at peak (db 1 GB, claude 2 GB, web 1.5 GB during a build, the rest small).
- Access: over Tailscale. `web` publishes one port on 127.0.0.1; HTTPS via `tailscale serve` in front of
  it (install.sh runs it when Tailscale is there). Nothing is exposed to the internet or the LAN.

## Auth and profiles

- One app password, set in the first-run wizard (`/setup`, guarded by the one-time `SETUP_TOKEN`) or as
  `APP_PASSWORD_HASH` (`scrypt:<salt>:<hash>`). DB-backed session (`core.sessions`, 30 days) in an
  httpOnly cookie; login limited to 10 attempts per IP per 15 minutes.
- `core.profiles (id, name, created_at)`; the profile is picked in the UI, there are no user accounts.
  The wizard creates the first one. Default profile (Claude's tools, services): `DEFAULT_PROFILE`, else
  the first profile.
- Every per-profile extension table has `profile_id` → `core.profiles(id) ON DELETE CASCADE`.

## Claude container

- Image: Node 22 + Claude Code + git + psql + python3, non-root user (`HOST_UID`).
- Volumes: the repo checkout (the same files `web` runs), `claude-home` (login state), `/logs`
  read-only. `.env` is shadowed by an empty file.
- Log in once: `docker compose exec -it claude claude`, then `/login`. The entrypoint then keeps
  `claude remote-control` running in `/workspace`, restarting it with backoff.
- Data chat: `psql "$CLAUDE_RO_DATABASE_URL"`. `claude_ro` has `SELECT` on core and extension schemas,
  `default_transaction_read_only = on`, a 30 s statement timeout, and no access to `secrets` or to an
  extension's `secret_*` tables.

## Keeping Claude from breaking things

1. **No Docker socket.** Claude cannot stop, remove or rebuild containers.
2. **Deploy = commit to the checkout.** `web` runs `scripts/live-reload.mjs`: it builds into
   `build-next/` and swaps it into `build/` only after a successful build, so a broken edit never
   replaces the running app. Compose/Dockerfile edits apply only through auto-update (spec 006) or a
   human rebuild.
3. **Every change is a commit.** The pre-commit hook blocks `.env`, `DROP`/`TRUNCATE` in migrations,
   broken shell scripts and failing tests. Undo is `git revert`; with `CLAUDE_GITHUB_TOKEN` set, commits
   are pushed, so history also lives off the machine.
4. **Read-only data access** for conversations. Schema changes go through new migration files.
5. **Daily backups** (`pg_dump`, 14 days) in the `backups` volume.
6. **`AGENTS.md` + `.claude/settings.json`**: profile, extension and migration rules, deny rules for
   `.env`, force pushes, `--no-verify`, `docker`.
