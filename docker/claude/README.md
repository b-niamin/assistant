# Claude container

Claude Code (and Codex, once signed in) running inside the stack, reachable through Remote Control, and the
in-app terminal (the dock at the bottom of the app; `services/terminal`, port 7681 on the internal network).

## First start

```sh
docker compose up -d --build claude
docker compose exec -it claude claude     # then type /login and follow the link
```

Exit the interactive session after logging in (`/exit`). The entrypoint notices the stored login and
starts `claude remote-control` in `/workspace`; the session then shows up in claude.ai. Login state
lives in the `claude-home` volume, so it survives restarts. To log out, run `/logout` the same way.

Or sign in from the terminal in the bar at the bottom of the app: it runs in this container.

Codex works the same way: after `codex login --device-auth` (in that terminal) the entrypoint starts
`codex remote-control --no-daemon` next to Claude's (experimental in Codex 0.167). The bar shows each
one's state: it reads `~/.beni/remote/<agent>.json`, which the entrypoint keeps up to date.

Both show up under the host's name (`ASSISTANT_HOSTNAME` in `.env`, which `install.sh` sets from the host),
not under a random container id. Codex runs in a detached tmux session (it stops without a terminal):
its output is in `~/.beni/remote/codex.log`, live with `docker compose exec claude tmux attach -t remote-codex`.

Logs: `docker compose logs -f claude`.

## What it can and cannot do

| Can | Cannot |
|---|---|
| edit any file in the repo checkout (`/workspace`) and commit | reach the Docker socket (no stopping, removing or rebuilding containers) |
| query data with `psql "$CLAUDE_RO_DATABASE_URL"` (read-only role) | read `.env` (shadowed by an empty file) or `secrets` / an extension's `secret_*` tables |
| read sync logs in `/logs` | write to the database (`default_transaction_read_only`) |
| push commits, if `CLAUDE_GITHUB_TOKEN` is set | change running infrastructure: a `docker-compose.yml` edit applies only when a human runs `docker compose up` |

Every commit goes through `scripts/hooks/pre-commit`. A bad change is undone with `git revert`.

## Pushing commits (SSH deploy key)

Give the container its own key, kept in the `claude-home` volume, and add it to the repo as a deploy key
with write access (GitHub: repo Settings -> Deploy keys). It can then push this repo and nothing else.

```sh
docker compose exec claude sh -c 'mkdir -p ~/.ssh && ssh-keygen -t ed25519 -N "" -C claude-assistant -f ~/.ssh/id_ed25519 && ssh-keyscan github.com >> ~/.ssh/known_hosts && cat ~/.ssh/id_ed25519.pub'
```

The checkout's `origin` must be the SSH URL (`git@github.com:<you>/assistant.git`, your fork).
`CLAUDE_GITHUB_TOKEN` (HTTPS) still works as an alternative.

## File ownership

The checkout is bind-mounted, so the container user must be able to write it. If the host owner is
not uid 1000 (on Synology it is usually 1026), set `HOST_UID` in `.env` to the output of `id -u` and
rebuild: `docker compose build claude`.
