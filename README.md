<p align="center">
  <img src="apps/web/static/pip.svg" alt="Pip, the assistant's mascot: an orange jelly-bean runner in a sweatband" width="160" />
</p>

# assistant-core

A private, self-hosted assistant you run at home: a small **core shell** (password, profiles, dashboard,
System settings, an in-app terminal and browser) plus **extensions**, the apps. Claude runs inside the
stack, reached through Remote Control, talks to every extension and builds new ones on request.

Meet **Pip**, the mascot: a jelly-bean runner in a sweatband who greets you on the dashboard and keeps
every empty screen company.

- Ready-made extensions (Training & Health from Garmin, a gym tracker, example skeletons):
  [assistant-extensions](https://github.com/b-niamin/assistant-extensions)
- Architecture: [specs/000-architecture.md](specs/000-architecture.md), extensions:
  [specs/002-extensions.md](specs/002-extensions.md), security: [specs/004-security.md](specs/004-security.md)
- Rules for working in this repo: [CLAUDE.md](CLAUDE.md)

## Install (one command)

On any Linux machine or NAS with Docker and Compose (Tailscale optional but recommended):

```sh
curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant-core/main/install.sh | sh -s -- health gym
```

The words after `--` are extensions to install from the extensions repo; leave them out for a bare core.
It clones this repo into `~/assistant` (`ASSISTANT_DIR=...` to change it), writes `.env` with random
secrets, installs the extensions, starts the stack, runs `tailscale serve` when Tailscale is there, sets
up auto-update from `main` ([spec 006](specs/006-auto-update.md); `ASSISTANT_AUTO_UPDATE=0` skips it)
and prints the address plus a one-time setup code. Open `/setup` there, set the app password and your
profile; everything else is in **System settings** (`/settings`).

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
3. **Install** as root (Docker on DSM needs it), into a folder on the data volume:

   ```sh
   sudo -i
   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant-core/main/install.sh \
     | ASSISTANT_DIR=/volume1/docker/assistant-core sh -s -- health gym
   ```

   The checkout is handed to your own user (the one that ran `sudo`), and the containers run as that
   user. The first build takes 10-20 minutes on a small NAS.
4. **Auto-update**: the installer prints a Task Scheduler entry. Control Panel → Task Scheduler → Create
   → Scheduled Task → User-defined script, user `root`, daily, every 5 minutes, with the printed command.
5. **First run**: open the printed address + `/setup` (e.g. `https://<nas>.<tailnet>.ts.net/setup`),
   type the setup code, choose the app password and your profile.
6. **Claude**: `cd /volume1/docker/assistant-core && docker compose exec -it claude claude`, then `/login`
   and `/exit`. Remote Control keeps running from then on (or log in from System settings → Terminal).
7. **Garmin** (health extension): `docker compose exec -it garmin-sync python -m sync login`; history:
   `docker compose exec garmin-sync python -m sync backfill`.

Replacing an older install: stop it first (`docker compose down` in its folder, and disable its Task
Scheduler entry). A new folder name gives the new install fresh volumes, so the old data stays until you
remove it (`docker compose down -v` in the old folder).

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
