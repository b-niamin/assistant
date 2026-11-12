# Install and run

The details behind the quick install in the [README](../README.md): what the installer asks and does, a
Synology walkthrough, the everyday `beni.sh` commands, extensions and development.

## What the installer does

It asks a few questions, each with a suggestion you take with Enter: the folder
(`/volume1/docker/assistant` on a Synology, `~/assistant` elsewhere), a free local port, the HTTPS
port on your tailnet (443, or 8443 when something is already served there), the extensions to install
(checkboxes from the extensions repo's `catalog.json`) and whether to update itself from `main` ([spec 006](../specs/006-auto-update.md)). Then it
clones this repo, writes `.env` with random secrets, installs the extensions, starts the stack, runs
`tailscale serve` and prints the address plus a one-time setup code. Open `/setup` there, set the app
password and your profile; everything else is in **System settings** (`/settings`).

In a terminal it then walks you through the rest step by step: it waits for the app, shows the setup
address and code, reminds you of the Synology schedule, and offers to log in to Claude and Garmin.

It shows numbered progress for each phase. The last question is how to start: by the installer
(default), or by yourself, e.g. in Synology Container Manager or Portainer: then it prepares
`stack/docker-compose.yml` (extensions merged in) and `stack/.env` and tells you where to point the tool.

Unattended: `... | sudo ASSISTANT_YES=1 sh` takes the suggestions; `ASSISTANT_DIR`, `WEB_PORT`,
`ASSISTANT_HTTPS_PORT`, `ASSISTANT_EXTENSIONS`, `ASSISTANT_AUTO_UPDATE=0|1`, `ASSISTANT_START=now|manual`
and `ASSISTANT_PROJECT` (the compose project name) answer up front.

Containers and volumes are named after the compose project: the folder name, pinned in `.env` as
`COMPOSE_PROJECT_NAME` so the folder can move later. When another folder's stack already uses that name
(the older single-repo install also lived in a folder called `assistant`), a new install takes the next
free one (`assistant-2`) and says so.

Two steps stay in a terminal because they log in to outside accounts:

```sh
docker compose exec -it terminal claude                 # /login once (or from the app's terminal)
docker compose exec -it garmin-sync python -m sync login   # only with the health extension (password never stored)
```

Re-running `./install.sh` is safe: it keeps `.env` and your extensions. Run it again after adding an
extension that brings a background service.

## Step by step on a Synology NAS

1. **Packages** (DSM, Package Center): *Container Manager*; *Git* (or *Git Server*), for `git`; and
   *Tailscale*, signed in to your tailnet, to reach the app over HTTPS.
2. **SSH**: Control Panel → Terminal & SNMP → enable SSH. From your computer: `ssh <you>@<nas>`.
3. **Install**: the command above, answering with Enter. Next to another app it suggests a free port
   and another tailnet port, and its own compose project name keeps its containers and volumes separate. The checkout
   belongs to you (the user who ran `sudo`); the first build takes 10-20 minutes on a small NAS.
4. **Updates**: the installer prints a Task Scheduler entry. Control Panel → Task Scheduler → Create
   → Scheduled Task → User-defined script, user `root`, daily, every minute from 00:00 to **23:59** (the *Last run time*; the default 00:59 stops it after the first hour), with the printed command
   (`sh /volume1/docker/assistant-updater/update.sh`). It updates by itself, or only when you click
   Update in System settings if you chose manual updates.
5. **First run**: open the printed address + `/setup`, type the setup code, choose the app password and
   your profile.
6. **Claude Code and Codex**: unlock with the lock at the top of the app, then System settings → Terminal
   → Sign in (or `docker compose exec -it terminal claude`, then `/login` and `/exit`). They run in the
   terminal at the bottom of the app.
7. **Claude connector** (claude.ai and the Claude apps): see below.
8. **Garmin** (health extension): `docker compose exec -it garmin-sync python -m sync login`; history:
   `docker compose exec garmin-sync python -m sync backfill`.

Replacing an older install: stop it first (`docker compose down` in its folder, and disable its Task
Scheduler entry). The new install has its own compose project, so fresh volumes, and the old data stays
until you remove it (`docker compose down -v` in the old folder).

Installs made before the default folder became `/volume1/docker/assistant` live in
`/volume1/docker/assistant-core`. To move one (the data stays; the containers and volumes keep the
`assistant-core` names):

```sh
cd /volume1/docker/assistant-core && sudo ./beni.sh move /volume1/docker/assistant
```

It stops the stack, moves the folder and the updater next to it, and runs the installer there. Then change
the update task's command in DSM Task Scheduler to the one it prints.

## Everyday: `beni.sh`

One command for the host (Synology: `sudo` in front):

```sh
./beni.sh status                 # containers and whether the app answers
./beni.sh doctor                 # checks permissions, git, .env, the database password; says what to run
./beni.sh start | stop | restart # the whole stack, or one service
./beni.sh logs web               # follow a service's log
./beni.sh update                 # update to GitHub main now, with a progress bar (--status, --cancel)
./beni.sh ext available          # extensions: available, install <id>, update <id>, list
./beni.sh fix-permissions        # owner, Synology ACLs and modes in the checkout
./beni.sh fix-db-password        # the database keeps its data, takes the password in .env
./beni.sh move <new-folder>      # move the install elsewhere, data kept
./beni.sh backup [--list]        # make a backup now | list them
./beni.sh restore <backup>       # bring one back (also on a new machine, after the installer)
```

Run `git` in the checkout as yourself, not with sudo: files git writes as root stop the containers
and your next `git pull`. `sudo ./beni.sh update` updates as the checkout's owner and repairs what an
earlier `sudo git pull` left behind. It is the same update the scheduled task runs (and System settings
→ Updates shows): run it again, or click Resume, if one was interrupted ([spec 006](../specs/006-auto-update.md)).

A database volume keeps the password it was created with. A new `.env` next to an old volume (a fresh
clone into the same folder name) makes the installer stop instead of failing later with "password
authentication failed": put the old `.env` back, run `sudo ./beni.sh fix-db-password`, or remove the
`<project>_db-data` volume to start empty.

## Backups

The `backup` service makes one backup a day (at `BACKUP_HOUR`, 3:00 by default, local time; at once when
the last one is more than a day old) into `BACKUP_DIR`, a host folder next to the checkout
(`../assistant-backups`, e.g. `/volume1/docker/assistant-backups`; never inside the checkout, which the
terminal sees). Each backup is a folder `beni-<day>_<time>` with everything a new machine needs:

| File | What |
| --- | --- |
| `db.dump` | the database (`pg_dump -Fc`), checked with `pg_restore --list` before it counts |
| `env` | `.env`: the keys that decrypt stored secrets and service logins live only there |
| `extensions.tgz` | the installed extensions, including ones Claude built here |
| `manifest.json` | when, Postgres version, sizes |

Kept: the last 7 days, 4 Sundays and 6 first-of-the-months (`BACKUP_KEEP_DAILY`, `_WEEKLY`, `_MONTHLY`).
Old ones go only after a backup succeeded. The files belong to root and only root can read them.
System settings → Backups shows the last good one and has Back up now; `./beni.sh doctor` warns when the
last one is more than 36 hours old.

A backup on the same disk does not survive the disk: let the host copy `BACKUP_DIR` elsewhere (Synology
Hyper Backup to another device or a cloud, Time Machine, `rsync` to a second machine). It holds `.env`,
so encrypt that copy.

Restore, on this machine or a new one (after `install.sh` there):

```sh
sudo ./beni.sh restore /volume1/docker/assistant-backups/beni-2026-11-12_0300
```

It backs up the current state first, takes the keys from the backup's `env` (this machine keeps its own
passwords, ports and address), puts the current extensions in `extensions/.trash/`, recreates the
database from the dump and starts everything; `migrate` puts back the roles. Works across machines and
CPU types (NAS, Mac, Raspberry Pi): the dump is logical.

### Upgrading Postgres

A new Postgres major (the `db` image) cannot read an older one's files, so the database moves through its
daily dump. When `db` stops with "This volume holds a Postgres 16 database", make sure the last backup is
recent (`./beni.sh doctor`), keep the old files aside and restore into a new volume (`<project>` is
`COMPOSE_PROJECT_NAME` in `.env`):

```sh
sudo ./beni.sh stop
sudo docker volume create <project>_db-data-old
sudo docker run --rm -v <project>_db-data:/a -v <project>_db-data-old:/b alpine cp -a /a/. /b/
sudo docker compose -p <project> rm -f db && sudo docker volume rm <project>_db-data
sudo ./beni.sh restore <BACKUP_DIR>/beni-<latest>
```

Once the app works, remove the old files: `sudo docker volume rm <project>_db-data-old`.

`install.sh` stays the first-time command (`curl ... | sudo sh`); `./beni.sh install` runs it again.
Its tool output goes to `install.log`; only the tail is shown when a step fails.

## Claude connector (claude.ai, the Claude apps)

The app's MCP server can be added to Claude as a custom connector. claude.ai calls it from the internet,
so only that server is published, through Tailscale Funnel; the app stays on the tailnet.

1. Once, in the Tailscale admin console: allow Funnel for this machine (Access controls, the `funnel`
   node attribute; Tailscale's Funnel docs show the snippet). If you skip it, the settings page shows the
   link Tailscale prints to enable it.
2. System settings → Claude connector → Turn on. The host's updater runs `tailscale funnel` within a
   minute, and the page shows that it is on.
3. Profile settings (menu under the avatar) → Claude and MCP: copy an address ("All apps", or add your own
   with the apps it shows and whether it may change data).
4. claude.ai → Settings → Connectors → Add custom connector, with that address. Connect opens a page with a
   code; approve the same code in Profile settings → Claude and MCP.

Turning it off removes the Funnel and every connection. Details: [spec 005](../specs/005-claude-tools.md).

## Extensions

```sh
docker compose exec terminal node scripts/ext.mjs available       # what the extensions repo offers
docker compose exec terminal node scripts/ext.mjs install <id>    # then ./install.sh if it has a service
docker compose exec terminal node scripts/ext.mjs update <id>
```

Or just ask Claude: "add the gym tracker", "build me a habit tracker inspired by <link>".
`extensions/` is git-ignored: what is installed belongs to your instance, not to this repo.

## Develop

```sh
git config core.hooksPath scripts/hooks
cd apps/web && npm ci && npm test && npm run check && npm run dev
```
