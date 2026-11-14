# terminal container (the in-app terminal)

The shell behind the dock at the bottom of the app (spec 004): bash in tmux, with Claude Code, Codex, `gh`,
`psql` and Python. The web app proxies the dock's WebSocket here after checking the session and a
single-use ticket; this container publishes no port and has no Docker socket and no `.env`.

Claude Code and Codex run only inside this container: in this shell, started by hand or by the app, or behind
the app's chat (below). Nothing runs them in the
background, and nothing reaches them from outside. From outside, Claude reaches the apps' data through
the public MCP connector instead (System settings -> Claude connector, spec 005).

## Chat

The app's main way to work with Claude is the chat (`/chat`, the Chat button in the header); this terminal is
the backup, hidden until the owner turns it on in the user menu ("Turn on the terminal") or a page hands it a
command. The chat runs the same `claude` CLI here, headless (`services/terminal/chat.mjs`):
`claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`, in
`/workspace`, on the CLI's own login (no API key), with the same managed settings and `beni-guard.mjs`. What the
guard answers "ask" for arrives as a `can_use_tool` request and shows in the chat as an Allow/Deny card;
AskUserQuestion shows its options. A chat's process quits after 20 idle minutes and the next message resumes
the session (`--resume`). Chats live in `~/.beni/chats` (the `agent-home` volume). The web app reaches them
through `/chat/api/...` with a single-use `chat` ticket per request; writing needs the unlocked session, which
leaves an 8-hour chat grant behind (like a connected terminal) until the lock. Pages that hand the AI a request
(Ask the AI to translate, Update an extension) open a chat; with Codex as the default AI they still use a tmux
window.

## Sign-ins

System settings -> Terminal and AI has a Sign in button per tool; it types the command into the dock:

| Tool | Command |
|---|---|
| Claude Code | `claude`, then `/login` |
| Codex | `codex login --device-auth` |
| GitHub CLI | `gh auth login` |

Login state lives in the `agent-home` volume (`/home/claude`), so it survives restarts and rebuilds.

## What the entrypoint does

1. Marks `/workspace` safe for git and points git at `scripts/hooks` (the pre-commit checks).
2. With `CLAUDE_GITHUB_TOKEN` set, adds a credential helper that reads it from the environment.
3. Forwards `localhost:9222` to the browser container's CDP (`browser` MCP server in `.mcp.json`).
4. Copies the CLIs into `~/.npm-global` when needed (`cli-home.mjs`, see below).
5. Writes the `assistant` and `browser` MCP servers into `~/.codex/config.toml` (`codex-config.mjs`, its own
   marked blocks only), plus `sandbox_mode = "danger-full-access"` (Codex's bubblewrap sandbox cannot run in
   a container) and `approval_policy = "on-request"`, and copies `beni.rules` to `~/.codex/rules/`.
6. Starts the terminal server (`services/terminal/server.mjs`).

## Updates of the CLIs

Claude Code and Codex update themselves (`npm install -g`, as Claude's auto-update and Codex's "Update now"
run it). The image installs them as root into `/usr/local`, which the container user cannot write, so global
npm installs go to `~/.npm-global` in the `agent-home` volume instead (`NPM_CONFIG_PREFIX`, first on `PATH`).
The terminal server passes `NPM_CONFIG_PREFIX` into the shell it starts (and `/etc/profile.d/beni-path.sh`
sets it for login shells): without it the CLIs see root's `/usr/local` and fail with "no write permission
to npm prefix".
On every start the entrypoint copies each CLI from the image there when the home copy is missing or older
(`cli-home.mjs`), so a rebuilt image with a newer version still wins over an older self-update. `claude doctor`
should show `npm-global` with a path under `~/.npm-global`.

## What the agents may do

Everything, without asking, except critical changes, which wait for the owner's approval in the terminal.

| Without asking | Asks the owner first |
|---|---|
| edit any file in the checkout (`/workspace`), extensions included, and commit | a push that can reach `main` (the host's updater deploys it as root), a force push, deleting a branch, `gh pr merge`, deleting a repo or release |
| read data: `beni-db -c 'SELECT ...'` (role `claude_ro`) | SQL that deletes data or changes schema or roles: `DELETE`, `DROP`, `TRUNCATE`, `ALTER`, `GRANT`... |
| write data: `beni-db --write -c 'INSERT/UPDATE ...'` (role `agent_rw`; Codex asks for every `--write`) | `git reset --hard`, `git clean -f`, `git branch -D`, `git stash drop`, history rewrites |
| use every extension through the `assistant` MCP server, `node scripts/ext.mjs install/update/new/check` | `rm -r` outside `/tmp` and build folders, `node scripts/ext.mjs remove`, `ext-run` (a command as an extension's service, with its keys) |
| push a feature branch, open a PR | changing their own permission settings (`~/.claude/settings*.json`, `~/.codex/config.toml`, `~/.codex/rules/`) |

How: Claude Code reads `/etc/claude-code/managed-settings.json` (allow list, `bypassPermissions` off) and
runs `beni-guard.mjs` before every shell command and file edit; the guard answers "ask" for the list above.
Codex runs with `approval_policy = "on-request"` and the execpolicy rules in `beni.rules`. Both files are
root-owned in the image, so an agent cannot loosen them; change them here, in the repo.

Hard limits, which no approval prompt can be talked past:

| Limit | Where |
|---|---|
| no Docker socket, no `.env` (an empty file shadows it) | `docker-compose.yml` |
| `agent_rw` owns nothing: no `CREATE`/`ALTER`/`DROP`, no `TRUNCATE`, no `secrets`, `core.sessions` or connector tokens | `db/roles.sql`, `db/extension-role.sql` |
| nothing from the checkout runs as the database superuser: core migrations and db scripts are baked into the migrate image from `main` | `docker/migrate/Dockerfile`, spec 006 |
| the updater deploys only GitHub `main`, builds from its own mirror, and refuses a checkout `docker-compose.yml` that differs from main | `scripts/update.sh` |
| an extension's `compose.yml` that could reach the host (privileged, `cap_add`, devices, host namespaces, Docker socket, host paths but `/proc` and `/sys` read-only) is not started | `scripts/compose-policy.sh`, `install.sh` |

Still open: code the agents edit in `apps/web` and `extensions/` runs live in `web`, which holds the app's
secrets; and a commit on `main` (pushed after approval) is deployed by the updater as root, including a new
updater. Signed commits and a separate dev stack would close those (security audit, K1).

Every commit goes through `scripts/hooks/pre-commit`. A bad change is undone with `git revert`.

## File ownership

The checkout is bind-mounted, so the container user must be able to write it. If the host owner is
not uid 1000 (on Synology it is usually 1026), set `HOST_UID` in `.env` to the output of `id -u` and
rebuild: `docker compose build terminal`.
