#!/bin/sh
# One-command install of the assistant on a NAS or any Linux box with Docker (spec 002, "Install").
#
#   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant/main/install.sh | sudo sh
#   # or, from a checkout:  ./install.sh [extension ...]
#
# In a terminal it asks a few questions (folder, port, Tailscale, start, updates); Enter takes the
# suggestion, which avoids what is already running. ASSISTANT_YES=1 (or no terminal) takes them all. The
# rest (the app password, your profile, the language, the apps, the Claude connector) is the web wizard at
# /setup. It installs into ./assistant (the folder it runs from + assistant). Defaults can be changed
# up front: ASSISTANT_DIR, WEB_PORT, ASSISTANT_HTTPS_PORT,
# ASSISTANT_EXTENSIONS (or arguments: sh -s -- health gym), ASSISTANT_AUTO_UPDATE=0|1 and
# ASSISTANT_START=manual (you start the stack yourself). ASSISTANT_PROJECT names the compose project of a
# new install (default: the folder name; pinned in .env). ASSISTANT_TAILSCALE=0 leaves Tailscale alone (no
# `tailscale serve`; the app stays on localhost; kept in .env as TAILSCALE_SERVE=0).
# Interrupted (Ctrl-C, a closed terminal)? Run it again: it goes on where it stopped. `./beni.sh uninstall`
# removes everything it made.
#
# What it does, and nothing else:
#   1. checks Docker + Compose, clones the repo (ASSISTANT_REPO, ASSISTANT_DIR) if not run from a checkout,
#   2. writes .env with fresh random secrets (only if .env does not exist yet; chmod 600),
#   3. installs the extensions named as arguments (or in ASSISTANT_EXTENSIONS) from the extensions repo,
#   4. lists the installed extensions' compose.yml in COMPOSE_FILE, builds and starts the stack,
#   5. publishes it on your tailnet with `tailscale serve` if Tailscale is installed,
#   6. sets up the updater (scripts/update.sh, spec 006; ASSISTANT_AUTO_UPDATE=0 = manual updates, from the app),
#   7. waits for the app and prints its address and the one-time setup code for the web wizard (/setup).
# Re-running it is safe: it keeps .env and the installed extensions, and only (re)starts the stack.
# Run it again after Claude installs an extension that brings a background service.
set -eu
# sudo's PATH may miss the Synology packages' binaries (docker, tailscale).
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Tailscale/target/bin

REPO=${ASSISTANT_REPO:-https://github.com/b-niamin/assistant.git}
EXTENSIONS=${*:-${ASSISTANT_EXTENSIONS-}}

# Output: a numbered line per phase, "  ·" for news, "  ✓"/"  ✗" for steps. Tool output (docker builds,
# ext, auto-update) goes to install.log in the checkout, and only its tail is shown when a step fails.
say() { printf '  \033[2m·\033[0m %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
LOG=/dev/null
# quietly "label" command...: runs it with its output in $LOG, a ticking line meanwhile, ✓ or ✗ after.
quietly() {
  label=$1; shift
  printf '\n=== %s  %s\n' "$(date -u +%H:%M:%S)" "$label" >> "$LOG"
  "$@" >> "$LOG" 2>&1 &
  pid=$!; t0=$(date +%s)
  # Ctrl-C stops the step too (a background job ignores it), and says how to go on.
  trap 'kill "$pid" 2>/dev/null; printf "\n" >&2; die "Interrupted. Run the same command again to go on where it stopped."' INT TERM HUP
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  \033[2m…\033[0m %s \033[2m%ss\033[0m\033[K' "$label" "$(($(date +%s) - t0))"
      sleep 1
    done
    printf '\r\033[K'
  fi
  if wait "$pid"; then trap - INT TERM HUP; ok "$label ($(($(date +%s) - t0))s)"; return 0; fi
  trap - INT TERM HUP
  printf '  \033[31m✗\033[0m %s failed. Last lines of %s:\n' "$label" "$LOG" >&2
  tail -n 25 "$LOG" | sed 's/^/    /' >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "Docker is not installed (Synology: Package Center > Container Manager)."
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose is missing."; fi
docker info >/dev/null 2>&1 || die "Cannot talk to Docker. Run it with sudo (curl ... | sudo sh), or as a user in the docker group."

# 0. the defaults (a new install only; a re-run keeps what .env says)
port_used() { # a host port something already listens on, or a container publishes
  { netstat -ltn 2>/dev/null || ss -ltn 2>/dev/null; } | grep -qE "[:.]$1[[:space:]]" && return 0
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "[:.]$1->"
}
free_port() { p=$1; while port_used "$p"; do p=$((p + 1)); done; echo "$p"; }
tailnet_https_used() { command -v tailscale >/dev/null 2>&1 && tailscale serve status --json 2>/dev/null | grep -q "\"$1\""; }
# ./assistant in the folder this runs from (cd /volume1/docker first on a Synology).
here=$(pwd); default_dir=${here%/}/assistant
in_checkout=no
[ -f docker-compose.yml ] && [ -f scripts/ext.mjs ] && [ -f install.sh ] && in_checkout=yes
# ASSISTANT_DIR, when given, wins over the folder this runs in (curl ... | sudo sh from inside another checkout).
if [ -n "${ASSISTANT_DIR:-}" ] && [ "$in_checkout" = yes ] && [ "$(cd "$ASSISTANT_DIR" 2>/dev/null && pwd)" != "$(pwd)" ]; then
  in_checkout=no
fi
if [ "$in_checkout" = yes ]; then DIR=$(pwd); else DIR=${ASSISTANT_DIR:-}; fi
# A few questions on a new install when there is a terminal (Enter takes the suggestion); ASSISTANT_YES=1,
# or no terminal, takes every default. A choice given as a variable is not asked.
ask() { # $1 = variable, $2 = question, $3 = suggestion
  printf '\033[1m?\033[0m %s [%s]: ' "$2" "$3" > /dev/tty
  IFS= read -r a < /dev/tty || a=""
  eval "$1=\${a:-\$3}"
}
yes_no() { # $1 = question, $2 = y|n suggestion; true for yes
  ask _yn "$1 (y/n)" "$2"; case $_yn in [nN]*) return 1 ;; *) return 0 ;; esac
}
interactive=no
[ "${ASSISTANT_YES:-0}" != 1 ] && (exec < /dev/tty) 2>/dev/null && interactive=yes
if [ "$interactive" = yes ] && [ -z "$DIR" ] && [ ! -f "$default_dir/.env" ]; then
  printf '\n  Beni Assistant installer. Enter takes the suggestion in [brackets].\n\n' > /dev/tty
  ask DIR "Install folder" "$default_dir"
  case $DIR in /*) ;; *) DIR=$(pwd)/$DIR ;; esac
fi
DIR=${DIR:-$default_dir}
# A finished install has INSTALLED_AT in .env; an interrupted one runs again (its ports stay).
complete=no
[ -f "$DIR/.env" ] && grep -q '^INSTALLED_AT=' "$DIR/.env" && complete=yes
if [ -f "$DIR/.env" ]; then
  PORT=$(sed -n 's/^WEB_PORT=//p' "$DIR/.env"); PORT=${PORT:-3000}
  HTTPS_PORT=$(sed -n 's/^TAILNET_HTTPS_PORT=//p' "$DIR/.env"); HTTPS_PORT=${HTTPS_PORT:-443}
  saved_ts=$(sed -n 's/^TAILSCALE_SERVE=//p' "$DIR/.env" | tail -n 1)
  ASSISTANT_TAILSCALE=${ASSISTANT_TAILSCALE:-${saved_ts:-1}}
else
  PORT=${WEB_PORT:-$(free_port 3000)}
  if [ "$interactive" = yes ]; then
    while [ -z "${WEB_PORT:-}" ]; do
      ask PORT "Local port for the app" "$PORT"
      case $PORT in '' | *[!0-9]*) printf '  not a port number\n' > /dev/tty; PORT=$(free_port 3000); continue ;; esac
      port_used "$PORT" && { printf '  port %s is in use\n' "$PORT" > /dev/tty; PORT=$(free_port "$PORT"); continue; }
      break
    done
    if [ -z "${ASSISTANT_TAILSCALE:-}" ] && command -v tailscale >/dev/null 2>&1; then
      yes_no "Publish it on your tailnet over HTTPS (tailscale serve)? n = this machine only" y || ASSISTANT_TAILSCALE=0
    fi
  fi
  if [ "${ASSISTANT_TAILSCALE:-1}" = 0 ]; then HTTPS_PORT=443
  elif [ -n "${ASSISTANT_HTTPS_PORT:-}" ]; then HTTPS_PORT=$ASSISTANT_HTTPS_PORT
  elif tailnet_https_used 443; then HTTPS_PORT=8443; while tailnet_https_used "$HTTPS_PORT"; do HTTPS_PORT=$((HTTPS_PORT + 1)); done
  else HTTPS_PORT=443; fi
  if [ "$interactive" = yes ] && [ "${ASSISTANT_TAILSCALE:-1}" != 0 ] && [ -z "${ASSISTANT_HTTPS_PORT:-}" ] && command -v tailscale >/dev/null 2>&1; then
    ask HTTPS_PORT "HTTPS port on your tailnet (443 = https://<machine>; another keeps what is served on 443)" "$HTTPS_PORT"
  fi
fi
# How it is started (now = by this installer, manual = Container Manager & co.): kept in .env.
saved_start=$(sed -n 's/^START_MODE=//p' "$DIR/.env" 2>/dev/null | tail -n 1)
if [ "$interactive" = yes ] && [ ! -f "$DIR/.env" ]; then
  if [ -z "${ASSISTANT_START:-}" ]; then
    yes_no "Start it now? n = you start it yourself (Synology Container Manager, Portainer)" y || ASSISTANT_START=manual
  fi
  if [ -z "${ASSISTANT_AUTO_UPDATE:-}" ]; then
    if yes_no "Update by itself from GitHub main? n = only when you click Update in the app" y; then ASSISTANT_AUTO_UPDATE=1
    else ASSISTANT_AUTO_UPDATE=0; fi
  fi
fi
START=${ASSISTANT_START:-${saved_start:-now}}
if [ "$complete" = yes ]; then
  # Re-run: keep everything; only extensions named on the command line are added.
  [ $# -gt 0 ] || [ -n "${ASSISTANT_EXTENSIONS+x}" ] || EXTENSIONS=""
else
  AUTO=${ASSISTANT_AUTO_UPDATE:-1}
  ASSISTANT_AUTO_UPDATE=$AUTO
  [ -f "$DIR/.env" ] || ! port_used "$PORT" || die "port $PORT is already in use; pick another (WEB_PORT=...)"
fi
# "health, gym" and "health gym" both work.
EXTENSIONS=$(printf '%s' "$EXTENSIONS" | tr ',' ' ')

# Progress: one numbered line per phase ("Installing extensions" only when there are some).
PHASES=5
[ -z "$EXTENSIONS" ] || PHASES=6
n_phase=0
phase() { n_phase=$((n_phase + 1)); printf '\n\033[1;38;5;208m%s/%s\033[0m \033[1m%s\033[0m\n' "$n_phase" "$PHASES" "$*"; }

# 1. checkout
phase "Getting the code"
if [ "$in_checkout" = yes ]; then
  :
elif [ -d "$DIR/.git" ]; then
  say "using the checkout in $DIR"
else
  command -v git >/dev/null 2>&1 || die "git is missing (Synology: Package Center > Git Server, or set up a checkout by hand)."
  [ ! -e "$DIR" ] || [ -z "$(ls -A "$DIR" 2>/dev/null)" ] || die "$DIR exists and is not a checkout of the assistant: pick another folder (ASSISTANT_DIR=...)"
  say "cloning $REPO into $DIR"
  mkdir -p "$(dirname "$DIR")"
  # Into a side folder first, so an interrupted clone never looks like a checkout to the next run.
  rm -rf "$DIR.cloning"
  trap 'rm -rf "$DIR.cloning"; printf "\n" >&2; die "Interrupted. Run the same command again to start over."' INT TERM HUP
  git clone --quiet "$REPO" "$DIR.cloning" || { rm -rf "$DIR.cloning"; die "could not clone $REPO"; }
  trap - INT TERM HUP
  rmdir "$DIR" 2>/dev/null || true
  if [ -d "$DIR" ]; then # an empty folder that stays (a mount point): the files go into it
    (cd "$DIR.cloning" && tar cf - .) | (cd "$DIR" && tar xf -) && rm -rf "$DIR.cloning"
  else mv "$DIR.cloning" "$DIR"; fi
fi
cd "$DIR"
# installed_ids, env_value (shared with beni.sh and the db scripts); an older checkout may lack it.
[ ! -f db/lib.sh ] || . ./db/lib.sh
# The containers run as the checkout's owner (HOST_UID), never root. Run as root (through sudo) on a new
# install, the checkout goes to the user who ran sudo (or ASSISTANT_UID).
if [ "$(id -u)" = 0 ] && [ ! -f .env ] && [ "$(stat -c %u .)" = 0 ]; then
  owner=${ASSISTANT_UID:-${SUDO_UID:-}}
  [ -n "$owner" ] && [ "$owner" != 0 ] ||
    die "The checkout would belong to root. Run this with sudo from your own account, or set ASSISTANT_UID=<your uid> (id -u)."
  group=$(awk -F: -v u="$owner" '$3 == u { print $4; exit }' /etc/passwd 2>/dev/null)
  chown -R "$owner:${group:-${SUDO_GID:-$owner}}" "$DIR"
fi
LOG=$DIR/install.log
git config core.hooksPath scripts/hooks 2>/dev/null || true
# Synology ACLs show every file as r-xr-xr-x+; with them removed (below) the x bits stay, and git would
# count each file as changed, which stops `git pull` and auto-update. Modes are not worth tracking here.
[ -d /volume1 ] && git config core.fileMode false 2>/dev/null || true
# Run as root (sudo -i on Synology), git rewrites .git/config as root: give it back to the checkout owner.
[ "$(id -u)" = 0 ] && chown "$(stat -c %u:%g .)" .git/config 2>/dev/null || true
# The containers write the checkout as HOST_UID: files a root run (sudo) left behind, or Synology ACLs
# on a shared folder (DSM puts them on every new file, and they deny writes), would stop them and a
# later `git pull` (spec 006). Fixed right away, so even a run that stops below leaves a usable checkout.
if [ "$(id -u)" = 0 ]; then quietly "Permissions for the containers (owner, Synology ACLs)" sh scripts/update.sh fix-permissions "$DIR"; fi
# The compose project name: volumes and containers are prefixed with it. It is pinned in .env
# (COMPOSE_PROJECT_NAME), so the folder can move or be renamed later and keep its data. A new install takes
# ASSISTANT_PROJECT, else the folder name; when containers of another folder already use that name (an
# install in another folder of the same name), the two stacks would be one, so it takes the next free one.
taken_elsewhere() {
  docker ps -a --filter "label=com.docker.compose.project=$1" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null |
    grep -v -x -e "$DIR" -e "$DIR/stack" | grep -q .
}
PROJECT=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | tail -n 1)
if [ -z "$PROJECT" ]; then
  PROJECT=$(printf '%s' "${ASSISTANT_PROJECT:-$(basename "$DIR")}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')
  if [ ! -f .env ] && [ -z "${ASSISTANT_PROJECT:-}" ] && taken_elsewhere "$PROJECT"; then
    base=$PROJECT n=2
    while taken_elsewhere "$base-$n"; do n=$((n + 1)); done
    PROJECT=$base-$n
    say "another install already uses the compose project $base (its own folder): this one is $PROJECT"
  fi
fi
had_db=no
docker volume inspect "${PROJECT}_db-data" >/dev/null 2>&1 && had_db=yes

# 2. secrets
phase "Writing the configuration (.env with fresh random secrets)"
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"$1"; }
fernet() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n'; }
origin=""
tailscale_state=missing
[ "${ASSISTANT_TAILSCALE:-1}" = 0 ] && tailscale_state=off
if [ "$tailscale_state" = missing ] && command -v tailscale >/dev/null 2>&1; then
  tailscale_state=silent
  host=$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1)
  [ -n "$host" ] && origin="https://$host$( [ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")" && tailscale_state=on
fi
[ -n "$origin" ] || origin="http://localhost:$PORT"
tz=${ASSISTANT_TIMEZONE:-}
[ -n "$tz" ] || tz=$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed -n 's|.*/zoneinfo/||p')
[ -n "$tz" ] || tz=UTC

if [ -f .env ]; then
  say ".env exists, keeping it"
else
  # New secrets cannot open a database made with older ones (a re-clone into the same folder name):
  # stop rather than leave migrate failing with "password authentication failed".
  if [ "$had_db" = yes ]; then
    die "A database from an earlier install exists (volume ${PROJECT}_db-data), but there is no .env here.
    Its password is in the .env of that install: put that .env back in $DIR and run this again.
    Or start with an empty database (deletes that data; backups stay in BACKUP_DIR):
      sudo docker compose -p $PROJECT down && sudo docker volume rm ${PROJECT}_db-data
    then run this again. If that database belongs to another install (in another folder with the
    same name), keep it and give this one its own name: sudo ASSISTANT_PROJECT=<name> ./install.sh"
  fi
  say "writing .env with new random secrets"
  umask 077
  cat > .env <<ENV
# Written by install.sh on $(date -u +%Y-%m-%dT%H:%MZ). Keep this file private; back it up.
POSTGRES_PASSWORD=$(rand 40)
APP_DB_PASSWORD=$(rand 40)
CLAUDE_DB_PASSWORD=$(rand 40)
# Login of extension background services (role ext_<id>_svc).
SERVICES_DB_PASSWORD=$(rand 40)
# Fernet key extension services encrypt stored logins with (e.g. Garmin). Losing it means logging in again.
TOKEN_ENCRYPTION_KEY=$(fernet)
# Encrypts extension secrets (System settings). Losing it means entering them again.
SECRETS_KEY=$(rand 48)
# One-time code for the first-run wizard at /setup.
SETUP_TOKEN=$(rand 24)
# Signs the single-use tickets for the in-app terminal and browser.
SIDECAR_TICKET_SECRET=$(rand 48)
# Lets Claude call the extensions' tools (the assistant MCP server).
CLAUDE_TOOLS_TOKEN=$(rand 48)
# The address you open the app at (CSRF checks depend on it).
PUBLIC_ORIGIN=$origin
TAILNET_HTTPS_PORT=$HTTPS_PORT
# Days and charts follow this time zone.
APP_TIMEZONE=$tz
# Owner of this checkout, so the containers can edit it (not root, even when run with sudo).
HOST_UID=$(stat -c %u .)
WEB_PORT=$PORT
# The MCP listener's host port (the Claude connector, spec 005).
MCP_PORT=$(free_port 3101)
# Containers and volumes are named after it: pinned, so moving the folder keeps them.
COMPOSE_PROJECT_NAME=$PROJECT
# The daily backups: a folder of this install's own, next to the checkout (never inside it).
BACKUP_DIR=../$(basename "$DIR")-backups
# 0 = this installer leaves Tailscale alone (ASSISTANT_TAILSCALE=0).
TAILSCALE_SERVE=${ASSISTANT_TAILSCALE:-1}
ENV
  chmod 600 .env
fi

# Which installed extensions bring a service: their compose.yml joins the stack through COMPOSE_FILE.
compose_files() {
  files=docker-compose.yml
  if [ -f extensions/installed.json ]; then
    for id in $(installed_ids extensions/installed.json); do
      [ -f "extensions/$id/compose.yml" ] || continue
      # Started as root: a file that could reach the host (privileged, Docker socket...) stays out.
      if ! sh scripts/compose-policy.sh "extensions/$id/compose.yml" >&2; then
        say "not starting $id's service: its compose.yml breaks the rules above (scripts/compose-policy.sh)"; continue
      fi
      files="$files:extensions/$id/compose.yml"
    done
  fi
  # Absolute paths: some Compose wrappers (Synology's) do not run in this folder.
  abs=$(printf '%s\n' "$files" | tr ':' '\n' | sed "s|^|$DIR/|" | tr '\n' ':' | sed 's/:$//')
  sed -i '/^COMPOSE_FILE=/d' .env
  printf 'COMPOSE_FILE=%s\n' "$abs" >> .env
  [ "$files" = docker-compose.yml ] || say "extension services: ${files#docker-compose.yml:}"
}
# Compose with everything explicit (folder, .env, files), whatever directory the binary thinks it is in.
dc() {
  set -- -p "$PROJECT" --project-directory "$DIR" --env-file "$DIR/.env" $(sed -n 's/^COMPOSE_FILE=//p' "$DIR/.env" | tr ':' '\n' | sed 's/^/-f /') "$@"
  $DC "$@"
}
compose_files

# 3. extensions: copied from the extensions repo by the same `ext` CLI Claude uses, in the claude image
# (node + git, runs as the checkout owner).
mkdir -p extensions

if [ -n "$EXTENSIONS" ]; then
  phase "Installing extensions"
  quietly "Building the terminal image (a few minutes the first time)" dc build terminal
  # shellcheck disable=SC2086 # one word per extension id
  quietly "Copying $EXTENSIONS from the extensions repo" dc run --rm --no-deps -T --entrypoint node terminal scripts/ext.mjs install $EXTENSIONS
  compose_files
fi

# 4. start
if [ "$START" = manual ]; then
  phase "Preparing the stack for your own tool (not starting it)"
  # One self-contained compose file: absolute paths, extensions merged in, values from .env filled in
  # (older Compose cannot render ${VARS} in ports unresolved). It holds the secrets: mode 600, git-ignored.
  mkdir -p stack
  render() { (umask 077 && dc config > stack/docker-compose.yml.new) && mv stack/docker-compose.yml.new stack/docker-compose.yml; }
  quietly "Writing stack/docker-compose.yml" render
  grep -v "^COMPOSE_FILE=" .env > stack/.env && chmod 600 stack/.env stack/docker-compose.yml
  # Synology Container Manager reads the project as another user: it needs the folder and both files
  # readable (they then are for every account on the NAS that can open this folder).
  if [ -d /volume1 ]; then chmod 755 stack && chmod 644 stack/.env stack/docker-compose.yml; fi
  [ "$(id -u)" = 0 ] && chown -R "$(stat -c %u:%g .)" stack 2>/dev/null || true
else
  phase "Building and starting (the first run takes 10-20 minutes on a small NAS)"
  # An existing database keeps the password it was made with: check .env opens it before migrate
  # would fail on it with "password authentication failed".
  if [ "$had_db" = yes ]; then
    quietly "Starting the database" dc up -d --no-deps db
    sh ./beni.sh check-db || die "Stopped: .env does not match the existing database (see above)."
    ok "The database takes the password in .env"
  fi
  quietly "Building images and starting the containers" dc up -d --build --remove-orphans
fi

# 5. tailnet
phase "Publishing on your tailnet and setting up updates"
if [ "$(sed -n 's/^TAILSCALE_SERVE=//p' .env | tail -n 1)" = 0 ]; then
  say "Tailscale left alone (TAILSCALE_SERVE=0 in .env)"
elif command -v tailscale >/dev/null 2>&1; then
  if tailscale serve --bg --https="$HTTPS_PORT" "$PORT" >/dev/null 2>&1 ||
    sudo tailscale serve --bg --https="$HTTPS_PORT" "$PORT" >/dev/null 2>&1; then
    ok "On your tailnet: $(sed -n 's/^PUBLIC_ORIGIN=//p' .env)"
  else
    say "Could not run 'tailscale serve --bg --https=$HTTPS_PORT $PORT'; run it yourself for HTTPS"
  fi
fi

# Root-owned files or Synology ACLs in the checkout stop web/claude from writing it (spec 006).
if [ "$(id -u)" = 0 ]; then quietly "Permissions for the containers" sh scripts/update.sh fix-permissions "$DIR"; fi

# 6. the updater (spec 006): a mirror outside the checkout plus a schedule every minute, which updates by
# itself or, with manual updates, when the app asks. On Synology the schedule is a Task Scheduler entry;
# the installer prints what to paste.
manual=""; [ "${ASSISTANT_AUTO_UPDATE:-1}" != 0 ] || manual=--manual
if (quietly "Updates from GitHub main" sh scripts/update.sh install $manual "$DIR"); then
  updater="${ASSISTANT_UPDATER_HOME:-$(dirname "$DIR")/$(basename "$DIR")-updater}/update.sh"
  if [ -f /etc/synoinfo.conf ]; then
    say "Add it once in DSM: Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script,"
    say "user root, daily every minute, first run 00:00, last run time 23:59 (not 00:59), command:  sh $updater"
  fi
else
  say "Updater not set up; later: sudo ./beni.sh update"
fi

# 7. next steps
phase "Done"
grep -q '^INSTALLED_AT=' .env || printf 'INSTALLED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" >> .env
sed -i '/^START_MODE=/d' .env && printf 'START_MODE=%s\n' "$START" >> .env
token=$(sed -n 's/^SETUP_TOKEN=//p' .env)
backups=$(sed -n 's/^BACKUP_DIR=//p' .env | tail -n 1); backups=${backups:-../assistant-backups}
case $backups in /*) ;; ../*) backups=$(dirname "$DIR")/${backups#../} ;; *) backups=$DIR/$backups ;; esac
if [ "$START" = manual ] && [ -n "$(dc ps -q 2>/dev/null)" ]; then
  say "The stack is running. ./beni.sh update rebuilds or restarts what a pulled change touches."
elif [ "$START" = manual ]; then
  cat <<MANUAL

  Not started yet. Start it with one of:
    - Synology Container Manager: Project > Create. Name: $PROJECT  Path: $DIR/stack
      ("use the existing docker-compose.yml"), then Next > Done. The name must be $PROJECT
      so auto-update and the commands below find the same containers.
    - Portainer or another tool: the compose file $DIR/stack/docker-compose.yml with $DIR/stack/.env,
      project name $PROJECT.
    - A terminal:  cd $DIR && sudo ./beni.sh start
  The first start builds images: 10-20 minutes on a small NAS.
MANUAL
fi
cat <<NEXT

  Open:        $(sed -n 's/^PUBLIC_ORIGIN=//p' .env)/setup
  Setup code:  $token
$(case $(sed -n 's/^PUBLIC_ORIGIN=//p' .env) in
  http://localhost:*)
    case $tailscale_state in
      off) printf '  (Tailscale left alone: the app is on this machine only.' ;;
      silent) printf '  (Tailscale did not answer (signed in? tailscale up): the app is on this machine only.' ;;
      *) printf '  (No Tailscale here: the app is on this machine only.' ;;
    esac
    printf ' From another computer: ssh -L %s:localhost:%s <this-host>, then open http://localhost:%s/setup)\n' "$PORT" "$PORT" "$PORT" ;;
esac)

  The wizard there sets the app password, your profile and language, the apps, updates and Claude.
  Backups:     $backups (daily)
  Later:  ./beni.sh status | doctor | logs | ext available | update | uninstall   (./beni.sh help)

NEXT

# 8. wait for the app, then hand over to the browser: the wizard at /setup does the rest.
[ "$START" = now ] && [ "$complete" = no ] && command -v curl >/dev/null 2>&1 || exit 0
printf '  The web app builds itself on the first start (a few minutes on a small NAS).\n'
n=0
until curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz"; do
  n=$((n + 1)); [ "$n" -le 180 ] || { say "Still not up after 15 minutes; check: $DC logs web"; exit 0; }
  [ -t 1 ] && printf '\r  \033[2m…\033[0m waiting for the app \033[2m%ss\033[0m\033[K' "$((n * 5))"
  sleep 5
done
[ -t 1 ] && printf '\r\033[K'
ok "The app is up"
printf '\n\033[1mAll set.\033[0m Open %s/setup and enter the setup code %s\n\n' "$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)" "$token"
