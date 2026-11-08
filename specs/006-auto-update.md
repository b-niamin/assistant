# Spec 006: Auto-update from GitHub main

Status: **Implemented** · 2026-11-06

## Goal

A merge to `main` on GitHub reaches the host by itself: no `git pull`, no `docker compose up -d --build`,
no restarting the terminal by hand. Only what changed is rebuilt or restarted, a broken build never takes
the running version down, and System settings shows the last result.

## Choice

| Option | For | Against |
|---|---|---|
| Updater container with the Docker socket | everything in compose | the socket is root on the host, inside a container that sits next to the checkout Claude edits; breaks spec 004 ("no Docker socket in any container") |
| GitHub webhook over Tailscale | instant | needs a public endpoint (Funnel) or a relay, plus a listener that still needs Docker; more moving parts |
| **Host schedule (Synology Task Scheduler / cron), every 5 min** | no new container, no socket anywhere, survives a broken stack, nothing exposed | up to 5 minutes of delay; one manual step in DSM |

We use the host schedule. Polling a private mirror every 5 minutes is one `git fetch`; idle ticks write
nothing.

## How a tick works (`scripts/auto-update.sh run <checkout>`)

```
GitHub main ──git fetch (checkout owner's credentials)──► <checkout>-updater/mirror.git   (host only)
                                                               │
          throwaway container: --network none, checkout + mirror(ro) mounted, hooks off
          git fetch /mirror && git merge --ff-only <sha>  ──────►  <checkout>  (bind-mounted, live)
                                                               │
     changed = git diff --name-only <deployed> <sha>  (from the mirror)  ──►  plan
                                                               │
     images: built from docker/ + docker-compose.yml exported from the mirror, then `up -d --no-deps`
     restarts: `docker compose restart <svc>` for long-lived code that changed
```

| Changed path | Action |
|---|---|
| `docker-compose.yml` | build every image, `up -d` the whole project |
| `docker/claude/**` | rebuild and recreate `claude` and `terminal` (ends the running Claude session) |
| `docker/browser/**` | rebuild and recreate `browser` |
| `apps/web/scripts/live-reload.mjs` | restart `web` |
| `services/terminal/**` (not tests) | restart `terminal` |
| `db/watch-extensions.sh` | restart `ext-migrate` |
| `db/{migrate.sh,roles.sql,extension-role.sql}` | re-run `migrate`, restart `ext-migrate` |
| `db/backup.sh` | restart `backup` |
| anything else (`apps/web`, migrations, docs) | nothing: live already (live-reload, `ext-migrate`) |

Extensions are not part of this repo (`extensions/` is git-ignored), so auto-update never touches them;
`ext update <id>` does, and a changed extension `compose.yml` needs `./install.sh`.

`apps/web/package*.json` needs nothing either: live-reload compares their content hash with the one
stored in `node_modules/.lock-sha256` and runs `npm ci` in `.deps-next/` first, swapping the new
`node_modules` in only after it succeeded (so a failed install, or an old tree owned by another uid,
never leaves the server without its packages).

The mapping is `auto-update.sh plan`, tested by `scripts/auto-update.test.sh` (pre-commit). Add a row
there when a new long-lived service or build context appears.

- **Failure**: the build runs before any container is touched; a failed build or `up` leaves the old
  containers running, is logged and shown, and that commit is not retried until `main` moves again
  (`FORCE=1` retries). The next good commit deploys everything since the last good one.
- **Blocked**: the checkout is not on `main`, has local commits that are not on GitHub, or uncommitted
  changes are in the way of the fast-forward. Nothing is deployed; the status says why, once.
- **Self-update**: the scheduled copy (`<checkout>-updater/auto-update.sh`) replaces itself with main's
  `scripts/auto-update.sh` when that changes; the new version runs from the next tick.
- **Output**: `/logs/updater.log` and `/logs/updater-status.json` in the `logs` volume (`web` reads the
  status for System settings, `claude` can read the log). State (last deployed and failed commit) is in
  `<checkout>-updater/state`.

- **Permissions**: web, claude and terminal run as `HOST_UID` and must be able to write the checkout.
  `install`, every deploy and `install.sh` (as root) run `fix-permissions`: files not owned by
  `HOST_UID` are handed back (a `git pull` or `npm ci` once run as root), Synology ACLs are removed
  (DSM puts them on everything in a shared folder; they show as `r-xr-xr-x+` and deny writes whatever the
  owner), and the owner gets `u+rw` (`u+x` on directories). `.env` and git's read-only objects are left
  alone. By hand: `sudo sh scripts/auto-update.sh fix-permissions`.

## Security (spec 004)

The updater runs as root on the host, so the rule is: **nothing a container can write is executed or
trusted by it**.

- The script that runs, the commit it deploys, the list of changed files, the build contexts and the
  compose file all come from the mirror, which lives outside the checkout and is mounted read-only into
  the throwaway git container only. Its remote URL is set once by a human (`install`), not read from the
  checkout later.
- Every git command on the checkout runs in a container without network, as the checkout owner, with
  hooks off. A hook, `core.fsmonitor` or filter planted in `.git` by Claude runs there, not on the host.
- Compose always gets `-f docker-compose.yml` (an override file dropped into the checkout is ignored) and
  refuses to `up` when the checkout's `docker-compose.yml` differs from main's.
- Still true: whatever lands on GitHub `main` is deployed with Docker, which is root on the host.
  Protect `main` on GitHub (merge through PRs) and keep Claude's `CLAUDE_GITHUB_TOKEN` unable to push to
  it directly. A narrow race remains between the compose file check and `up`; exploiting it needs code
  already running in a container and an update that touches compose or images at that moment.

`scripts/auto-update.e2e.sh` (root + Docker) checks these on a throwaway project: idle tick, web-only
change, image change, broken build, tampered compose file, planted hook and fsmonitor, diverged
checkout, self-update.

## Install

`install.sh` runs `scripts/auto-update.sh install` at the end. By hand, on an existing install:

```sh
sudo -i
cd ~/assistant && git pull       # your checkout, e.g. /volume1/docker/assistant on Synology
sh scripts/auto-update.sh install
```

It clones the mirror next to the checkout (`<checkout>-updater/`), copies the
script there, records the running commit as deployed, and on a Linux box adds a cron line. On Synology it
prints the Task Scheduler entry: Control Panel → Task Scheduler → Create → Scheduled Task →
User-defined script, user `root`, daily every 5 minutes, command
`sh <checkout>-updater/auto-update.sh run <checkout>` (the installer prints it with your paths).

Status by hand: `sh scripts/auto-update.sh status`. Turn it off: disable the scheduled task.
