#!/bin/sh
# One-command install of the assistant on a NAS or any Linux box with Docker (spec 002, "Install").
#
#   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant/main/install.sh | sudo sh
#   # or, from a checkout:  ./install.sh [extension ...]
#
# In a terminal it asks a few questions (folder, port, tailnet port, extensions, auto-update), each with a
# default that avoids what is already running. Unattended: ASSISTANT_YES=1 takes the defaults; the
# answers can also be given up front as ASSISTANT_DIR, WEB_PORT, ASSISTANT_HTTPS_PORT,
# ASSISTANT_EXTENSIONS (or arguments: sh -s -- health gym) and ASSISTANT_AUTO_UPDATE=0|1. ASSISTANT_PROJECT
# names the compose project of a new install (default: the folder name; pinned in .env).
#
# What it does, and nothing else:
#   1. checks Docker + Compose, clones the repo (ASSISTANT_REPO, ASSISTANT_DIR) if not run from a checkout,
#   2. writes .env with fresh random secrets (only if .env does not exist yet; chmod 600),
#   3. installs the extensions named as arguments (or in ASSISTANT_EXTENSIONS) from the extensions repo,
#   4. lists the installed extensions' compose.yml in COMPOSE_FILE, builds and starts the stack,
#   5. publishes it on your tailnet with `tailscale serve` if Tailscale is installed,
#   6. sets up the updater (scripts/update.sh, spec 006; ASSISTANT_AUTO_UPDATE=0 = manual updates, from the app),
#   7. prints the address and the one-time setup code for the web wizard (/setup).
# Re-running it is safe: it keeps .env and the installed extensions, and only (re)starts the stack.
# Run it again after Claude installs an extension that brings a background service.
set -eu
# sudo's PATH may miss the Synology packages' binaries (docker, tailscale).
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Tailscale/target/bin

REPO=${ASSISTANT_REPO:-https://github.com/b-niamin/assistant.git}
EXTENSIONS=${*:-${ASSISTANT_EXTENSIONS-health gym}}

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
  if [ -t 1 ]; then
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  \033[2m…\033[0m %s \033[2m%ss\033[0m\033[K' "$label" "$(($(date +%s) - t0))"
      sleep 1
    done
    printf '\r\033[K'
  fi
  if wait "$pid"; then ok "$label ($(($(date +%s) - t0))s)"; return 0; fi
  printf '  \033[31m✗\033[0m %s failed. Last lines of %s:\n' "$label" "$LOG" >&2
  tail -n 25 "$LOG" | sed 's/^/    /' >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "Docker is not installed (Synology: Package Center > Container Manager)."
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose is missing."; fi
docker info >/dev/null 2>&1 || die "Cannot talk to Docker. Run it with sudo (curl ... | sudo sh), or as a user in the docker group."

# 0. the questions (only in a terminal, only for a new install; Enter takes the default)
port_used() { # a host port something already listens on, or a container publishes
  { netstat -ltn 2>/dev/null || ss -ltn 2>/dev/null; } | grep -qE "[:.]$1[[:space:]]" && return 0
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "[:.]$1->"
}
free_port() { p=$1; while port_used "$p"; do p=$((p + 1)); done; echo "$p"; }
tailnet_https_used() { command -v tailscale >/dev/null 2>&1 && tailscale serve status --json 2>/dev/null | grep -q "\"$1\""; }
ask() { # $1 = variable, $2 = question, $3 = default
  if [ -n "$3" ]; then printf '\033[1m?\033[0m %s [%s]: ' "$2" "$3"; else printf '\033[1m?\033[0m %s ' "$2"; fi > /dev/tty
  IFS= read -r a < /dev/tty || a=""
  eval "$1=\${a:-\$3}"
}
# The extensions repo's catalog.json, "id<TAB>name<TAB>description" per ready-made extension (max 20).
CATALOG_URL=${EXTENSIONS_CATALOG_URL:-https://raw.githubusercontent.com/b-niamin/assistant-extensions/main/catalog.json}
catalog_extensions() {
  { curl -fsSL "$CATALOG_URL" 2>/dev/null || wget -qO- "$CATALOG_URL" 2>/dev/null; } | awk '
    /"inspirations"/ { stop = 1 }
    stop { next }
    /"id":/ { if (id != "") print id "\t" name "\t" desc; id = $0; sub(/.*"id": *"/, "", id); sub(/".*/, "", id); name = ""; desc = "" }
    /"name":/ { name = $0; sub(/.*"name": *"/, "", name); sub(/",? *$/, "", name) }
    /"description":/ { desc = $0; sub(/.*"description": *"/, "", desc); sub(/",? *$/, "", desc) }
    END { if (id != "") print id "\t" name "\t" desc }' | grep -E '^[a-z][a-z0-9-]*	' | head -n 20
}
# Checkboxes: ↑/↓ move, Space ticks, Enter confirms (a typed number ticks that line too).
pick_extensions() {
  list=$(catalog_extensions)
  if [ -z "$list" ]; then
    ask EXTENSIONS "Extensions to install (could not read the catalog; ids, space separated, - for none)" "$EXTENSIONS"
    [ "$EXTENSIONS" = - ] && EXTENSIONS=""
    return
  fi
  chosen=" $(printf '%s' "$EXTENSIONS" | tr ',' ' ') "
  total=$(printf '%s\n' "$list" | wc -l | tr -d ' ')
  cols=$(stty size < /dev/tty 2>/dev/null | cut -d' ' -f2)
  [ "${cols:-0}" -ge 30 ] 2>/dev/null || cols=80
  cur=1
  saved=$(stty -g < /dev/tty)
  trap 'stty "$saved" < /dev/tty; printf "\033[?25h" > /dev/tty; exit 130' INT TERM
  stty -icanon -echo min 1 time 0 < /dev/tty
  printf '\n  \033[1mExtensions\033[0m  (↑/↓ move, Space tick, Enter confirm)\n\033[?25l' > /dev/tty
  drawn=no
  while :; do
    [ "$drawn" = yes ] && printf '\033[%sA' "$((total + 1))" > /dev/tty
    drawn=yes
    i=0
    printf '%s\n' "$list" | while IFS='	' read -r id name desc; do
      i=$((i + 1))
      case "$chosen" in *" $id "*) box='\033[38;5;208m[x]\033[0m' ;; *) box='[ ]' ;; esac
      if [ "$i" = "$cur" ]; then mark='\033[1m›'; else mark=' '; fi
      printf "\r\033[K  $mark $box %s\033[0m\n" "$name" > /dev/tty
    done
    desc=$(printf '%s\n' "$list" | sed -n "${cur}p" | cut -f3 | cut -c1-$((cols - 6)))
    printf '\r\033[K    \033[2m%s\033[0m\n' "$desc" > /dev/tty
    key=$(dd bs=1 count=1 < /dev/tty 2>/dev/null)
    case "$key" in
      "$(printf '\033')")
        rest=$(dd bs=1 count=2 < /dev/tty 2>/dev/null)
        case "$rest" in '[A' | 'OA') [ "$cur" -gt 1 ] && cur=$((cur - 1)) ;; '[B' | 'OB') [ "$cur" -lt "$total" ] && cur=$((cur + 1)) ;; esac ;;
      k) [ "$cur" -gt 1 ] && cur=$((cur - 1)) ;;
      j) [ "$cur" -lt "$total" ] && cur=$((cur + 1)) ;;
      ' ' | [1-9])
        n=$cur
        case "$key" in [1-9]) n=$key ;; esac
        id=$(printf '%s\n' "$list" | sed -n "${n}p" | cut -f1)
        [ -n "$id" ] || continue
        case "$chosen" in *" $id "*) chosen=$(printf '%s' "$chosen" | sed "s/ $id / /") ;; *) chosen="$chosen$id " ;; esac ;;
      '' | "$(printf '\r')") break ;;
    esac
  done
  stty "$saved" < /dev/tty
  trap - INT TERM
  printf '\033[?25h' > /dev/tty
  EXTENSIONS=$(printf '%s' "$chosen" | xargs)
  printf '\033[1A\r\033[K  \033[32m✓\033[0m Extensions: %s\n' "${EXTENSIONS:-none}" > /dev/tty
}
if [ -d /volume1 ]; then default_dir=/volume1/docker/assistant; else default_dir=$HOME/assistant; fi
in_checkout=no
[ -f docker-compose.yml ] && [ -f scripts/ext.mjs ] && [ -f install.sh ] && in_checkout=yes
# ASSISTANT_DIR, when given, wins over the folder this runs in (curl ... | sudo sh from inside another checkout).
if [ -n "${ASSISTANT_DIR:-}" ] && [ "$in_checkout" = yes ] && [ "$(cd "$ASSISTANT_DIR" 2>/dev/null && pwd)" != "$(pwd)" ]; then
  in_checkout=no
fi
if [ "$in_checkout" = yes ]; then DIR=$(pwd); else DIR=${ASSISTANT_DIR:-}; fi
interactive=no
[ "${ASSISTANT_YES:-0}" != 1 ] && (exec < /dev/tty) 2>/dev/null && interactive=yes
if [ "$interactive" = yes ] && [ -z "$DIR" ]; then
  printf '\n  Assistant installer. Press Enter to take the suggestion in [brackets].\n\n' > /dev/tty
  ask DIR "Install folder" "$default_dir"
fi
DIR=${DIR:-$default_dir}
# A finished install has INSTALLED_AT in .env; an interrupted one is asked again (its ports stay).
complete=no
[ -f "$DIR/.env" ] && grep -q '^INSTALLED_AT=' "$DIR/.env" && complete=yes
if [ -f "$DIR/.env" ]; then
  PORT=$(sed -n 's/^WEB_PORT=//p' "$DIR/.env"); PORT=${PORT:-3000}
  HTTPS_PORT=$(sed -n 's/^TAILNET_HTTPS_PORT=//p' "$DIR/.env"); HTTPS_PORT=${HTTPS_PORT:-443}
else
  PORT=${WEB_PORT:-$(free_port 3000)}
  if [ -n "${ASSISTANT_HTTPS_PORT:-}" ]; then HTTPS_PORT=$ASSISTANT_HTTPS_PORT
  elif tailnet_https_used 443; then HTTPS_PORT=8443; while tailnet_https_used "$HTTPS_PORT"; do HTTPS_PORT=$((HTTPS_PORT + 1)); done
  else HTTPS_PORT=443; fi
fi
# How it is started (now = by this installer, manual = Container Manager & co.): asked once, kept in .env.
saved_start=$(sed -n 's/^START_MODE=//p' "$DIR/.env" 2>/dev/null | tail -n 1)
START=${ASSISTANT_START:-${saved_start:-now}}
if [ "$complete" = yes ]; then
  # Re-run: keep everything; only extensions named on the command line are added.
  [ $# -gt 0 ] || [ -n "${ASSISTANT_EXTENSIONS+x}" ] || EXTENSIONS=""
else
  AUTO=${ASSISTANT_AUTO_UPDATE:-1}
  if [ "$interactive" = yes ]; then
    if [ ! -f "$DIR/.env" ]; then
      [ -n "${WEB_PORT:-}" ] || ask PORT "Local port for the app (free ones only)" "$PORT"
      if command -v tailscale >/dev/null 2>&1 && [ -z "${ASSISTANT_HTTPS_PORT:-}" ]; then
        ask HTTPS_PORT "HTTPS port on your tailnet (443 = plain https://<machine>...; another keeps what is served there)" "$HTTPS_PORT"
      fi
    fi
    if [ $# -eq 0 ] && [ -z "${ASSISTANT_EXTENSIONS+x}" ]; then
      pick_extensions
    fi
    if [ -z "${ASSISTANT_AUTO_UPDATE:-}" ]; then
      ask a_upd "Update by itself from GitHub main? (n = only when you click Update in the app) (y/n)" y
      case $a_upd in [nN]*) AUTO=0 ;; *) AUTO=1 ;; esac
    fi
    if [ -z "${ASSISTANT_START:-}" ]; then
      printf '  Start: 1 = now, by this installer (recommended)\n         2 = I start it myself (Synology Container Manager, Portainer, docker compose)\n' > /dev/tty
      ask a_start "How to start it? (1/2)" 1
      case $a_start in 2*) START=manual ;; *) START=now ;; esac
    fi
    printf '\n' > /dev/tty
  fi
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
  say "cloning $REPO into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$REPO" "$DIR"
fi
cd "$DIR"
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
# older install also called "assistant"), the two stacks would be one, so it takes the next free one.
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
if command -v tailscale >/dev/null 2>&1; then
  host=$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1)
  [ -n "$host" ] && origin="https://$host$( [ "$HTTPS_PORT" = 443 ] || echo ":$HTTPS_PORT")"
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
    Or start with an empty database (deletes that data; daily dumps stay in volume ${PROJECT}_backups):
      sudo docker compose -p $PROJECT down && sudo docker volume rm ${PROJECT}_db-data
    then run this again. If that database belongs to another install (an older one in a folder with the
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
ENV
  chmod 600 .env
fi
# Secrets added in later versions: append them to an older .env, never change existing ones.
for key in SECRETS_KEY SIDECAR_TICKET_SECRET CLAUDE_TOOLS_TOKEN SERVICES_DB_PASSWORD TOKEN_ENCRYPTION_KEY; do
  if ! grep -q "^$key=." .env; then
    sed -i "/^$key=\$/d" .env
    if [ "$key" = TOKEN_ENCRYPTION_KEY ]; then v=$(fernet); else v=$(rand 48); fi
    printf '%s=%s\n' "$key" "$v" >> .env
    say "added $key to .env"
  fi
done
# Older installs went by the folder name: pin it, so moving the folder keeps the same containers and volumes.
sed -i '/^COMPOSE_PROJECT_NAME=$/d' .env
grep -q '^COMPOSE_PROJECT_NAME=' .env || printf 'COMPOSE_PROJECT_NAME=%s\n' "$PROJECT" >> .env
# The MCP listener's host port (the Claude connector, spec 005): a free one, also for older installs.
grep -q '^MCP_PORT=' .env || printf 'MCP_PORT=%s\n' "$(free_port 3101)" >> .env

# Which installed extensions bring a service: their compose.yml joins the stack through COMPOSE_FILE.
compose_files() {
  files=docker-compose.yml
  if [ -f extensions/installed.json ]; then
    for id in $(grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-z][a-z0-9-]*"' extensions/installed.json | sed -E 's/.*"([a-z0-9-]+)"$/\1/'); do
      [ -f "extensions/$id/compose.yml" ] && files="$files:extensions/$id/compose.yml"
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
if command -v tailscale >/dev/null 2>&1; then
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
$( [ "$origin" = "http://localhost:$PORT" ] && echo "  (No Tailscale found: from your computer run  ssh -L $PORT:localhost:$PORT <this-host>  and open http://localhost:$PORT/setup)")

  Then, in a terminal on this host (in $DIR), or the app's terminal once it is set up:
    $DC exec -it terminal claude                      # /login once (or from the app's terminal)
$( [ -f extensions/health/compose.yml ] && echo "    $DC exec -it garmin-sync python -m sync login     # health: connect Garmin (password never stored)")

  Later:  ./beni.sh status | doctor | logs | ext available | update   (./beni.sh help)

NEXT

# 8. guided first run (terminal, new install only): walk through the steps above one by one.
[ "$interactive" = yes ] && [ "$complete" = no ] || exit 0
yes_no() { ask _yn "$1 (y/n)" y; case $_yn in [nN]*) return 1 ;; *) return 0 ;; esac; }
n_step=0
step() { n_step=$((n_step + 1)); printf '\n\033[1m== Step %s: %s\033[0m\n' "$n_step" "$*" > /dev/tty; }

if [ "$START" = manual ]; then
  step "start it"
  printf '  Start the stack now with your tool (see above); this waits for it.\n' > /dev/tty
fi
step "wait for the app"
printf '  The web app builds itself on the first start (a few minutes on a small NAS).\n' > /dev/tty
if command -v curl >/dev/null 2>&1; then
  n=0
  until curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz"; do
    n=$((n + 1)); [ "$n" -le 180 ] || { printf '  Still not up after 15 minutes; check: %s logs web\n' "$DC" > /dev/tty; break; }
    printf '.' > /dev/tty; sleep 5
  done
  printf '\n  The app is up.\n' > /dev/tty
fi

step "first-run setup in the browser"
printf '  Open   %s/setup\n  Code   %s\n  Choose the app password and your profile there.\n' \
  "$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)" "$token" > /dev/tty
ask _ "Press Enter when the setup page says you are done" ""

if [ -d /volume1 ]; then
  step "update schedule (Synology)"
  printf '  DSM: Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script.\n' > /dev/tty
  printf '  User root, daily, every minute, first run 00:00, last run time 23:59 (not 00:59),\n  and the command printed above by [update].\n' > /dev/tty
  ask _ "Press Enter when the task is saved" ""
fi

step "Claude"
printf '  Claude Code opens here: type /login, open the link it shows, sign in, then type /exit.\n' > /dev/tty
printf '  It then runs in the terminal at the bottom of the app (unlock it with the lock at the top).\n' > /dev/tty
printf '  To reach the apps from claude.ai or the Claude app: System settings > Claude connector.\n' > /dev/tty
if yes_no "Log in to Claude now?"; then
  dc exec -it terminal claude < /dev/tty > /dev/tty 2>&1 || printf '  Later: %s exec -it terminal claude\n' "$DC" > /dev/tty
fi

if [ -f extensions/health/compose.yml ]; then
  step "Garmin (health extension)"
  printf '  Your Garmin email and password (and an MFA code if asked). The password is never stored.\n' > /dev/tty
  if yes_no "Connect Garmin now?"; then
    if dc exec -it garmin-sync python -m sync login < /dev/tty > /dev/tty 2>&1; then
      if yes_no "Download your Garmin history in the background (takes a while)?"; then
        dc exec -d garmin-sync python -m sync backfill && printf '  Started; progress in /logs/garmin-sync.log.\n' > /dev/tty
      fi
    else
      printf '  Later: %s exec -it garmin-sync python -m sync login\n' "$DC" > /dev/tty
    fi
  fi
fi

printf '\n\033[1mAll set.\033[0m Open %s and say hello to Beni.\n\n' "$(sed -n 's/^PUBLIC_ORIGIN=//p' .env)" > /dev/tty
