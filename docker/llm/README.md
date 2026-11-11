# llm container (the AI agents)

Claude Code (and Codex, once signed in) running inside the stack, reachable through Remote Control.

## First start

```sh
docker compose up -d --build llm
docker compose exec -it llm claude     # then type /login and follow the link
```

Exit the interactive session after logging in (`/exit`). The entrypoint notices the stored login and
starts `claude remote-control` in `/workspace`; the session then shows up in claude.ai. Login state
lives in the `claude-home` volume, so it survives restarts. To log out, run `/logout` the same way.

Or sign in from the terminal in the bar at the bottom of the app (same `claude-home` volume).

Codex works the same way: after `codex login --device-auth` (in that terminal) the entrypoint starts
`codex remote-control --no-daemon` next to Claude's (experimental in Codex 0.167). The bar shows each
one's state: it reads `~/.beni/remote/<agent>.json`, which the entrypoint keeps up to date.

Both show up as `beni-assistant` (`ASSISTANT_HOSTNAME` in `.env` changes it),
not under a random container id. Claude runs in a detached tmux session (`remote-claude`); its first-run question "Enable Remote Control?
(y/n)" is answered y by the entrypoint. Codex runs as its own daemon (`codex remote-control start`, log in
`~/.codex/app-server-daemon/daemon.stderr.log`), which `codex remote-control pair` and the app's Remote menu
("Pair a device") need. Its control socket lives in `/tmp/codex-daemon-<uid>`, not in the home volume, so compose
shares that folder with the terminal (the `codex-daemon` volume), where the pairing code is asked for. Codex's enrollment needs a ChatGPT account with multi-factor authentication. Output: the
container log and `~/.beni/remote/<agent>.log`; live with `docker compose exec llm tmux attach -t remote-claude`.

Logs: `docker compose logs -f llm`.

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
docker compose exec llm sh -c 'mkdir -p ~/.ssh && ssh-keygen -t ed25519 -N "" -C claude-assistant -f ~/.ssh/id_ed25519 && ssh-keyscan github.com >> ~/.ssh/known_hosts && cat ~/.ssh/id_ed25519.pub'
```

The checkout's `origin` must be the SSH URL (`git@github.com:<you>/assistant.git`, your fork).
`CLAUDE_GITHUB_TOKEN` (HTTPS) still works as an alternative.

## File ownership

The checkout is bind-mounted, so the container user must be able to write it. If the host owner is
not uid 1000 (on Synology it is usually 1026), set `HOST_UID` in `.env` to the output of `id -u` and
rebuild: `docker compose build llm`.
