#!/bin/sh
# One-command install of the assistant on a NAS or any Linux box with Docker (spec 002, "Install").
#
#   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant-core/main/install.sh | sudo sh
#   # or, from a checkout:  ./install.sh [extension ...]
#
# In a terminal it asks a few questions (folder, port, tailnet port, extensions, auto-update), each with a
# default that avoids what is already running. Unattended: ASSISTANT_YES=1 takes the defaults; the
# answers can also be given up front as ASSISTANT_DIR, WEB_PORT, ASSISTANT_HTTPS_PORT,
# ASSISTANT_EXTENSIONS (or arguments: sh -s -- health gym) and ASSISTANT_AUTO_UPDATE=0|1.
#
# What it does, and nothing else:
#   1. checks Docker + Compose, clones the repo (ASSISTANT_REPO, ASSISTANT_DIR) if not run from a checkout,
#   2. writes .env with fresh random secrets (only if .env does not exist yet; chmod 600),
#   3. installs the extensions named as arguments (or in ASSISTANT_EXTENSIONS) from the extensions repo,
#   4. lists the installed extensions' compose.yml in COMPOSE_FILE, builds and starts the stack,
#   5. publishes it on your tailnet with `tailscale serve` if Tailscale is installed,
#   6. sets up auto-update from GitHub main (scripts/auto-update.sh, spec 006; ASSISTANT_AUTO_UPDATE=0 skips),
#   7. prints the address and the one-time setup code for the web wizard (/setup).
# Re-running it is safe: it keeps .env and the installed extensions, and only (re)starts the stack.
# Run it again after Claude installs an extension that brings a background service.
set -eu
# sudo's PATH may miss the Synology packages' binaries (docker, tailscale).
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Tailscale/target/bin

REPO=${ASSISTANT_REPO:-https://github.com/b-niamin/assistant-core.git}
EXTENSIONS=${*:-${ASSISTANT_EXTENSIONS-health gym}}

say() { printf '\033[1m[assistant]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[assistant]\033[0m %s\n' "$*" >&2; exit 1; }

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
  printf '  → %s\n' "${EXTENSIONS:-none}" > /dev/tty
}
if [ -d /volume1 ]; then default_dir=/volume1/docker/assistant-core; else default_dir=$HOME/assistant; fi
in_checkout=no
[ -f docker-compose.yml ] && [ -f scripts/ext.mjs ] && [ -f install.sh ] && in_checkout=yes
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
START=${ASSISTANT_START:-now}
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
      ask a_upd "Update by itself from GitHub main every 5 minutes? (y/n)" y
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

# Progress: one numbered line per phase.
PHASES=6
n_phase=0
phase() { n_phase=$((n_phase + 1)); printf '\n\033[1;38;5;208m[%s/%s]\033[0m \033[1m%s\033[0m\n' "$n_phase" "$PHASES" "$*"; }

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
  # Cloned as root through sudo: the checkout belongs to the user who ran sudo, so the containers run as them.
  if [ "$(id -u)" = 0 ] && [ -n "${SUDO_UID:-}" ] && [ "$SUDO_UID" != 0 ]; then
    chown -R "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$DIR"
  fi
fi
cd "$DIR"
git config core.hooksPath scripts/hooks 2>/dev/null || true
# Run as root (sudo -i on Synology), git rewrites .git/config as root: give it back to the checkout owner.
[ "$(id -u)" = 0 ] && chown "$(stat -c %u:%g .)" .git/config 2>/dev/null || true

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
  set -- --project-directory "$DIR" --env-file "$DIR/.env" $(sed -n 's/^COMPOSE_FILE=//p' "$DIR/.env" | tr ':' '\n' | sed 's/^/-f /') "$@"
  $DC "$@"
}
compose_files

# 3. extensions: copied from the extensions repo by the same `ext` CLI Claude uses, in the claude image
# (node + git, runs as the checkout owner).
# The containers write the checkout as HOST_UID: files a root run (sudo) left behind, or Synology ACLs
# on a shared folder, would stop them (spec 006). Fixed before anything runs in a container.
[ "$(id -u)" = 0 ] && sh scripts/auto-update.sh fix-permissions "$DIR" || true
mkdir -p extensions

if [ -n "$EXTENSIONS" ]; then
  phase "Installing extensions: $EXTENSIONS (builds the claude image first, a few minutes)"
  dc build claude
  # shellcheck disable=SC2086 # one word per extension id
  dc run --rm --no-deps -T --entrypoint node claude scripts/ext.mjs install $EXTENSIONS
  compose_files
fi

# 4. start
if [ "$START" = manual ]; then
  phase "Preparing the stack for your own tool (not starting it)"
  # One self-contained compose file: absolute paths, extensions merged in, values from .env filled in
  # (older Compose cannot render ${VARS} in ports unresolved). It holds the secrets: mode 600, git-ignored.
  mkdir -p stack
  (umask 077 && dc config > stack/docker-compose.yml.new) && mv stack/docker-compose.yml.new stack/docker-compose.yml
  grep -v "^COMPOSE_FILE=" .env > stack/.env && chmod 600 stack/.env stack/docker-compose.yml
  # Synology Container Manager reads the project as another user: it needs the folder and both files
  # readable (they then are for every account on the NAS that can open this folder).
  if [ -d /volume1 ]; then chmod 755 stack && chmod 644 stack/.env stack/docker-compose.yml; fi
  [ "$(id -u)" = 0 ] && chown -R "$(stat -c %u:%g .)" stack 2>/dev/null || true
else
  phase "Building and starting (the first run takes 10-20 minutes on a small NAS)"
  dc up -d --build --remove-orphans
fi

# 5. tailnet
phase "Publishing on your tailnet and setting up auto-update"
if command -v tailscale >/dev/null 2>&1; then
  if tailscale serve --bg --https="$HTTPS_PORT" "$PORT" >/dev/null 2>&1 ||
    sudo tailscale serve --bg --https="$HTTPS_PORT" "$PORT" >/dev/null 2>&1; then
    say "published on your tailnet: $(sed -n 's/^PUBLIC_ORIGIN=//p' .env)"
  else
    say "could not run 'tailscale serve --bg --https=$HTTPS_PORT $PORT'; run it yourself to reach the app over HTTPS"
  fi
fi

# Root-owned files or Synology ACLs in the checkout stop web/claude from writing it (spec 006).
[ "$(id -u)" = 0 ] && sh scripts/auto-update.sh fix-permissions "$DIR" || true

# 6. auto-update (spec 006): a mirror outside the checkout plus a 5-minute schedule. On Synology the
# schedule is a Task Scheduler entry; the installer prints what to paste.
if [ "${ASSISTANT_AUTO_UPDATE:-1}" != 0 ]; then
  sh scripts/auto-update.sh install "$DIR" || say "auto-update not set up; rerun: sudo sh scripts/auto-update.sh install"
fi

# 7. next steps
phase "Done"
grep -q '^INSTALLED_AT=' .env || printf 'INSTALLED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" >> .env
token=$(sed -n 's/^SETUP_TOKEN=//p' .env)
if [ "$START" = manual ]; then
  cat <<MANUAL

  Not started yet. Start it with one of:
    - Synology Container Manager: Project > Create. Name: $(basename "$DIR")  Path: $DIR/stack
      ("use the existing docker-compose.yml"), then Next > Done. The name must be $(basename "$DIR")
      so auto-update and the commands below find the same containers.
    - Portainer or another tool: the compose file $DIR/stack/docker-compose.yml with $DIR/stack/.env,
      project name $(basename "$DIR").
    - A terminal:  cd $DIR && sudo $DC up -d
  The first start builds images: 10-20 minutes on a small NAS.
MANUAL
fi
cat <<NEXT

  Open:        $(sed -n 's/^PUBLIC_ORIGIN=//p' .env)/setup
  Setup code:  $token
$( [ "$origin" = "http://localhost:$PORT" ] && echo "  (No Tailscale found: from your computer run  ssh -L $PORT:localhost:$PORT <this-host>  and open http://localhost:$PORT/setup)")

  Then, in a terminal on this host (in $DIR), or the app's terminal once it is set up:
    $DC exec -it claude claude                        # /login once, Remote Control starts by itself
$( [ -f extensions/health/compose.yml ] && echo "    $DC exec -it garmin-sync python -m sync login     # health: connect Garmin (password never stored)")

  Add apps later:  $DC exec claude node scripts/ext.mjs available   (then: ext.mjs install <id>, ./install.sh)

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

if [ "${ASSISTANT_AUTO_UPDATE:-1}" != 0 ] && [ -d /volume1 ]; then
  step "auto-update schedule (Synology)"
  printf '  DSM: Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script.\n' > /dev/tty
  printf '  User root, daily, every 5 minutes, and the command printed above by [auto-update].\n' > /dev/tty
  ask _ "Press Enter when the task is saved" ""
fi

step "Claude"
printf '  Claude Code opens here: type /login, open the link it shows, sign in, then type /exit.\n' > /dev/tty
printf '  After that Remote Control runs by itself (claude.ai > Code).\n' > /dev/tty
if yes_no "Log in to Claude now?"; then
  dc exec -it claude claude < /dev/tty > /dev/tty 2>&1 || printf '  Later: %s exec -it claude claude\n' "$DC" > /dev/tty
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
