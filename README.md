<p align="center">
  <img src="apps/web/static/beni.svg" alt="Beni, the assistant's mascot: an orange jelly-bean runner in a sweatband" width="160" />
</p>

# Beni Assistant

A private, self-hosted assistant you run at home: a small **core shell** (password, profiles, dashboard,
System settings, an in-app terminal and browser) plus **extensions**, the apps. Claude runs inside the
stack, reached through Remote Control, talks to every extension and builds new ones on request.

Meet **Beni**, the mascot: a jelly-bean runner in a sweatband who greets you on the dashboard and keeps
every empty screen company.

- Extensions: ready to install (Training & Health from Garmin, a gym tracker) and inspirations to build
  new ones from (Home Assistant, calendar, learning):
  [assistant-extensions](https://github.com/b-niamin/assistant-extensions)
- Architecture: [specs/000-architecture.md](specs/000-architecture.md), extensions:
  [specs/002-extensions.md](specs/002-extensions.md), security: [specs/004-security.md](specs/004-security.md)
- Rules for working in this repo (people and AI agents): [AGENTS.md](AGENTS.md); skills in [.ai/](.ai)

## Install (one command)

On any Linux machine or NAS with Docker and Compose (Tailscale optional but recommended):

```sh
curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant/main/install.sh | sudo sh
```

It asks a few questions, each with a suggestion you take with Enter: the folder
(`/volume1/docker/assistant-core` on a Synology, `~/assistant` elsewhere), a free local port, the HTTPS
port on your tailnet (443, or 8443 when something is already served there), the extensions to install
(checkboxes from the extensions repo's `catalog.json`) and whether to update itself from `main` ([spec 006](specs/006-auto-update.md)). Then it
clones this repo, writes `.env` with random secrets, installs the extensions, starts the stack, runs
`tailscale serve` and prints the address plus a one-time setup code. Open `/setup` there, set the app
password and your profile; everything else is in **System settings** (`/settings`).

In a terminal it then walks you through the rest step by step: it waits for the app, shows the setup
address and code, reminds you of the Synology schedule, and offers to log in to Claude and Garmin.

It shows numbered progress for each phase. The last question is how to start: by the installer
(default), or by yourself, e.g. in Synology Container Manager or Portainer: then it prepares
`stack/docker-compose.yml` (extensions merged in) and `stack/.env` and tells you where to point the tool.

Unattended: `... | sudo ASSISTANT_YES=1 sh` takes the suggestions; `ASSISTANT_DIR`, `WEB_PORT`,
`ASSISTANT_HTTPS_PORT`, `ASSISTANT_EXTENSIONS`, `ASSISTANT_AUTO_UPDATE=0|1` and `ASSISTANT_START=now|manual`
answer up front.

Two steps stay in a terminal because they log in to outside accounts:

```sh
docker compose exec -it claude claude                      # /login once; Remote Control then runs by itself
docker compose exec -it garmin-sync python -m sync login   # only with the health extension (password never stored)
```

Re-running `./install.sh` is safe: it keeps `.env` and your extensions. Run it again after adding an
extension that brings a background service.

### Step by step on a Synology NAS

1. **Packages** (DSM, Package Center): *Container Manager*; *Git* (or *Git Server*), for `git`; and
   *Tailscale*, signed in to your tailnet, to reach the app over HTTPS.
2. **SSH**: Control Panel → Terminal & SNMP → enable SSH. From your computer: `ssh <you>@<nas>`.
3. **Install**: the command above, answering with Enter. Next to another app it suggests a free port
   and another tailnet port, and the folder name keeps its containers and volumes separate. The checkout
   belongs to you (the user who ran `sudo`); the first build takes 10-20 minutes on a small NAS.
4. **Auto-update**: the installer prints a Task Scheduler entry. Control Panel → Task Scheduler → Create
   → Scheduled Task → User-defined script, user `root`, daily, every 5 minutes, with the printed command.
5. **First run**: open the printed address + `/setup`, type the setup code, choose the app password and
   your profile.
6. **Claude**: `cd /volume1/docker/assistant-core && docker compose exec -it claude claude`, then `/login`
   and `/exit`. Remote Control keeps running from then on (or log in from System settings → Terminal).
7. **Garmin** (health extension): `docker compose exec -it garmin-sync python -m sync login`; history:
   `docker compose exec garmin-sync python -m sync backfill`.

Moving from the older single-repo version: install this one next to it, then copy its data (profiles,
app data, health history, Garmin logins; a backup of the new database is taken first):

```sh
sudo ./beni.sh migrate /path/to/old/assistant   # the old checkout
```

Replacing an older install: stop it first (`docker compose down` in its folder, and disable its Task
Scheduler entry). A new folder name gives the new install fresh volumes, so the old data stays until you
remove it (`docker compose down -v` in the old folder).

## Everyday: `beni.sh`

One command for the host (Synology: `sudo` in front):

```sh
./beni.sh status                 # containers and whether the app answers
./beni.sh doctor                 # checks permissions, git, .env, the database password; says what to run
./beni.sh start | stop | restart # the whole stack, or one service
./beni.sh logs web               # follow a service's log
./beni.sh update                 # git pull + installer (keeps .env, extensions, answers)
./beni.sh ext available          # extensions: available, install <id>, update <id>, list
./beni.sh migrate <old-checkout> # copy data from an older install, after a backup
./beni.sh fix-permissions        # owner, Synology ACLs and modes in the checkout
./beni.sh fix-db-password        # the database keeps its data, takes the password in .env
```

Run `git` in the checkout as yourself, not with sudo: files git writes as root stop the containers
and your next `git pull`. `sudo ./beni.sh update` pulls as the checkout's owner and repairs what an
earlier `sudo git pull` left behind.

A database volume keeps the password it was created with. A new `.env` next to an old volume (a fresh
clone into the same folder name) makes the installer stop instead of failing later with "password
authentication failed": put the old `.env` back, run `sudo ./beni.sh fix-db-password`, or remove the
`<folder>_db-data` volume to start empty.

`install.sh` stays the first-time command (`curl ... | sudo sh`); `./beni.sh install` runs it again.
Its tool output goes to `install.log`; only the tail is shown when a step fails.

## Extensions

```sh
docker compose exec claude node scripts/ext.mjs available       # what the extensions repo offers
docker compose exec claude node scripts/ext.mjs install <id>    # then ./install.sh if it has a service
docker compose exec claude node scripts/ext.mjs update <id>
```

Or just ask Claude: "add the gym tracker", "build me a habit tracker inspired by <link>".
`extensions/` is git-ignored: what is installed belongs to your instance, not to this repo.

## Develop

```sh
git config core.hooksPath scripts/hooks
cd apps/web && npm ci && npm test && npm run check && npm run dev
```
