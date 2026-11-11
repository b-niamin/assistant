# terminal container (the in-app terminal)

The shell behind the dock at the bottom of the app (spec 004): bash in tmux, with Claude Code, Codex, `gh`,
`psql` and Python. The web app proxies the dock's WebSocket here after checking the session and a
single-use ticket; this container publishes no port and has no Docker socket and no `.env`.

Claude Code and Codex run only inside this shell: started by hand, or by the app (Update, Build it,
Install open them in a new tmux window with the request as the first message). Nothing runs them in the
background, and nothing reaches them from outside. From outside, Claude reaches the apps' data through
the public MCP connector instead (System settings -> Claude connector, spec 005).

## Sign-ins

System settings -> Terminal has a Sign in button per tool; it types the command into the dock:

| Tool | Command |
|---|---|
| Claude Code | `claude`, then `/login` |
| Codex | `codex login --device-auth` |
| GitHub CLI | `gh auth login` |

Login state lives in the `claude-home` volume (`/home/claude`), so it survives restarts and rebuilds.

## What the entrypoint does

1. Marks `/workspace` safe for git and points git at `scripts/hooks` (the pre-commit checks).
2. With `CLAUDE_GITHUB_TOKEN` set, adds a credential helper that reads it from the environment.
3. Forwards `localhost:9222` to the browser container's CDP (`browser` MCP server in `.mcp.json`).
4. Copies the CLIs into `~/.npm-global` when needed (`cli-home.mjs`, see below).
5. Writes the `assistant` and `browser` MCP servers into `~/.codex/config.toml` (`codex-config.mjs`, its own
   marked blocks only), plus `sandbox_mode = "danger-full-access"`: Codex's bubblewrap sandbox cannot run in
   a container, and the container is the sandbox.
6. Starts the terminal server (`services/terminal/server.mjs`).

## Updates of the CLIs

Claude Code and Codex update themselves (`npm install -g`, as Claude's auto-update and Codex's "Update now"
run it). The image installs them as root into `/usr/local`, which the container user cannot write, so global
npm installs go to `~/.npm-global` in the `claude-home` volume instead (`NPM_CONFIG_PREFIX`, first on `PATH`).
On every start the entrypoint copies each CLI from the image there when the home copy is missing or older
(`cli-home.mjs`), so a rebuilt image with a newer version still wins over an older self-update. `claude doctor`
should show `npm-global` with a path under `~/.npm-global`.

## What it can and cannot do

| Can | Cannot |
|---|---|
| edit any file in the repo checkout (`/workspace`) and commit | reach the Docker socket (no stopping, removing or rebuilding containers) |
| query data with `psql "$CLAUDE_RO_DATABASE_URL"` (read-only role) | read `.env` (shadowed by an empty file) or `secrets` / an extension's `secret_*` tables |
| call the apps' tools through the `assistant` MCP server | write to the database except through those tools |
| push commits, if `CLAUDE_GITHUB_TOKEN` is set or `gh` is signed in | change running infrastructure: a `docker-compose.yml` edit applies once it is on GitHub main (spec 006) |

Every commit goes through `scripts/hooks/pre-commit`. A bad change is undone with `git revert`.

## File ownership

The checkout is bind-mounted, so the container user must be able to write it. If the host owner is
not uid 1000 (on Synology it is usually 1026), set `HOST_UID` in `.env` to the output of `id -u` and
rebuild: `docker compose build terminal`.
