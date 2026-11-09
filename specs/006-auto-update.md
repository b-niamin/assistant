# Spec 006: Auto-update from GitHub main

Status: **Implemented** · 2026-11-06, rewritten 2026-11-09 (one command, resumable steps)

## Goal

A merge to `main` on GitHub reaches the host by itself: no `git pull`, no `docker compose up -d --build`,
no restarting the terminal by hand. Only what changed is rebuilt or restarted, a broken build never takes
the running version down, and System settings shows the last result.

## Choice

| Option | For | Against |
|---|---|---|
| Updater container with the Docker socket | everything in compose | the socket is root on the host, inside a container that sits next to the checkout Claude edits; breaks spec 004 ("no Docker socket in any container") |
| GitHub webhook over Tailscale | instant | needs a public endpoint (Funnel) or a relay, plus a listener that still needs Docker; more moving parts |
| **Host schedule (Synology Task Scheduler / cron), every minute** | no new container, no socket anywhere, survives a broken stack, nothing exposed | a click in the app waits up to a minute; one manual step in DSM |

We use the host schedule. Polling a private mirror every 4 minutes is one `git fetch`; idle runs write
nothing.

## One command

```
sh <checkout>-updater/update.sh        the scheduled task (root, every minute) and, in a terminal, "update now"
sudo ./beni.sh update                  the same from the checkout (sets the updater up on first use)
     ... --status | --cancel           what it does or did | stop a running update
```

The scheduled run (no terminal) checks GitHub every few minutes, updates when automatic updates are on,
takes the app's requests ("Update now", "Resume", "Cancel" in System settings → Updates, at most a minute
later) and finishes an update that was interrupted. Run in a terminal, the same command updates now and
draws a progress bar; when an update already runs, it follows that one instead.

Why not `beni.sh` in the schedule: the checkout is writable by the containers (Claude edits it), so root
must never run code from it on its own. The scheduled copy lives in `<checkout>-updater/` and replaces
itself only from the private mirror of GitHub main.

### What other self-hosted apps do, and what we took

Researched before the rewrite (2026-11-09): Coolify (host script, `STEP|MESSAGE|time` status file, a stale
status after 10 minutes, images pulled before anything stops), Home Assistant Supervisor (jobs with stage and
progress polled by the UI, one job at a time, health check after the update, rollback), Umbrel (one status
object `{running, progress, description, error}`, 409 when one runs, the failure kept in the status),
Watchtower (one code path for the schedule and the HTTP trigger), CasaOS (fire and forget `curl | bash` with
no lock or progress: updates that hang). Taken: a request file the host polls (no socket in a container), one
entry point for the schedule, the CLI and the app, slow work (builds) while the old containers run, a status
file with steps, a heartbeat so the app tells a dead update from a slow one, a time limit per step, a journal
of done steps so a rerun resumes, a lock that knows a dead holder (pid, its start time, the boot), a health
check at the end. Not taken (yet): rollback to the previous images; a failed update leaves the old
containers running where it had not replaced them.

## An update

```
GitHub main ──git fetch (checkout owner's credentials)──► <checkout>-updater/mirror.git   (host only)
                                                               │
     changed = git diff --name-only <deployed> <main>  (from the mirror)  ──►  plan  ──►  steps
                                                               │
 1. build:<svc>   images from docker/ + docker-compose.yml exported from the mirror; the old containers run on
 2. checkout      throwaway container (--network none, checkout + mirror(ro), hooks off): git merge --ff-only
 3. up:<svcs>     `up -d --no-deps` what was rebuilt (`up:all` when docker-compose.yml changed)
 4. migrate       the one-shot migrate service, when roles changed
 5. restart:<svc> long-lived code that changed
 6. verify        the touched services run (no crash loop, no failed exit) 15 s later
```

Before step 1 the same throwaway container checks that the checkout can take main at all (on `main`, no
local commits, no local changes in files the update changes); otherwise the update is paused ("blocked")
and nothing is built. Every step runs under a time limit (90 minutes for a build, 15 for the rest): a hung
`docker compose build` fails instead of holding the lock forever.

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

The mapping is `update.sh plan`, tested by `scripts/update.test.sh` (pre-commit). Add a row
there when a new long-lived service or build context appears.

- **Failure**: a failed step stops the update; whatever it had not replaced keeps running (a failed build
  changes nothing, not even the code). Automatic mode tries the same commit again after 30 minutes and
  2 hours, then waits for main to move or for "Update now" / `beni.sh update`.
- **Interrupted** (reboot, kill, power): the lock's process is gone but `<home>/state` still holds the
  journal (`target`, `base`, `done`, `attempt`). The next run takes the lock over and resumes, skipping the
  done steps (builds are cached anyway), up to 3 attempts. The app shows "interrupted" when the status says
  updating but no heartbeat came for 3 minutes, with Resume and Cancel.
- **Blocked**: the checkout is not on `main`, has local commits that are not on GitHub, or local changes
  are in the way. Nothing is built; the status says why, once; every run checks again, so fixing it is
  enough.
- **Self-update**: every run compares `<home>/update.sh` with main's `scripts/update.sh` (from the mirror)
  and, when it changed, replaces it and runs the new copy right away. An older install's task
  (`<home>/auto-update.sh run <checkout>`) keeps working: `scripts/auto-update.sh` hands over to update.sh.
- **Output**: `<home>/status.json` and, for the app, `/logs/updater-status.json` (status, message, step,
  steps, startedAt, attempt, the app request it took), `/logs/updater.log`, `/logs/updater-build.log` (the
  steps and the build output, as they run) and `/logs/updater-heartbeat` (every run, and every 15 s while
  an update runs). On the host, `<home>/last-run` and `<home>/last-error` (an error that stops a run also goes to
  `updater.log`: the scheduled task's own output is seen by nobody); `beni.sh update --status` shows both.
  The schedule runs `update.sh` without arguments: it finds its checkout in `<home>/checkout`, else by the
  home's name (`<checkout>-updater`), and writes the file on every run.

- **Permissions**: web, claude and terminal run as `HOST_UID` and must be able to write the checkout.
  `install`, every deploy and `install.sh` (as root) run `fix-permissions`: files not owned by
  `HOST_UID` are handed back (a `git pull` or `npm ci` once run as root), Synology ACLs are removed
  (DSM puts them on everything in a shared folder; they show as `r-xr-xr-x+` and deny writes whatever the
  owner), and the owner gets `u+rw` (`u+x` on directories). `.env` and git's read-only objects are left
  alone. Removing the ACLs leaves x bits on every file, so the checkout gets `core.fileMode false` (git
  would otherwise count every file as changed and stop the fast-forward). `install` also strips the ACL
  from the updater home, so the mirror is cloned as (and stays owned by) the checkout owner; a mirror an
  older version cloned as root is given back. By hand: `sudo ./beni.sh fix-permissions`;
  `./beni.sh doctor` reports what is wrong.

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

`scripts/update.e2e.sh` (root + Docker; on this project's test box it runs inside the Synology stand-in)
checks these and the rest on a throwaway project: idle run, each kind of change, a broken build (and its
retry), a hung build, an update killed halfway and resumed, two runs at once, cancel from the host and
from the app, manual mode, a terminal run with its bar, a tampered compose file, a planted hook and
fsmonitor, local changes and commits, stale and live locks, self-update, the older task handing over.

## Install

`install.sh` runs `scripts/update.sh install` at the end (`--manual` when automatic updates were
declined). By hand, `sudo ./beni.sh update` sets it up the first time. It clones the mirror next to the
checkout (`<checkout>-updater/`), copies the script there, records the running commit as deployed, and on
a Linux box adds a cron line (`* * * * * sh <home>/update.sh`). On Synology it prints the Task Scheduler
entry: Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script, user `root`, daily
every minute, command `sh <checkout>-updater/update.sh`. An idle run costs a heartbeat and, every 4
minutes, one `git fetch`.

## In the app

System settings → Updates: Automatic or Manual (`/logs/updater-control`: `mode=auto|manual`, plus
`request=<id>` for "Update now" / "Try again" / "Resume" and `cancel=<id>` for "Cancel"; the updater reads
them as root and never runs anything from them, and echoes the request it took in its status). While an
update runs: a progress bar (step n of m, what runs, since when, attempt), the last lines of the build
output, reloading every 5 seconds. A request not taken within 3 minutes means the scheduled task does not
run: the panel says so and names `sudo ./beni.sh update`. With no heartbeat for 20 minutes the updater
counts as stopped; the dock shows "Updating to <sha> · n/m", "Update interrupted", "Update available" or
"Updates stopped". `./beni.sh doctor` warns when no run happened for 15 minutes. All logs in `/logs` are
readable in System settings → Logs.
