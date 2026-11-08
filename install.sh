#!/bin/sh
# One-command install of the assistant on a NAS or any Linux box with Docker (spec 002, "Install").
#
#   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant-core/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/b-niamin/assistant-core/main/install.sh | sh -s -- health gym
#   # or, from a checkout:  ./install.sh [extension ...]
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

REPO=${ASSISTANT_REPO:-https://github.com/b-niamin/assistant-core.git}
DIR=${ASSISTANT_DIR:-$HOME/assistant}
PORT=${WEB_PORT:-3000}
EXTENSIONS=${*:-${ASSISTANT_EXTENSIONS:-}}

say() { printf '\033[1m[assistant]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[assistant]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is not installed (Synology: Package Center > Container Manager)."
if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else die "Docker Compose is missing."; fi
docker info >/dev/null 2>&1 || die "Cannot talk to Docker. Run as a user in the docker group, or with sudo -i first."

# 1. checkout
if [ -f docker-compose.yml ] && [ -f scripts/ext.mjs ] && [ -f install.sh ]; then
  DIR=$(pwd)
elif [ -d "$DIR/.git" ]; then
  say "using the checkout in $DIR"
else
  command -v git >/dev/null 2>&1 || die "git is missing (Synology: Package Center > Git Server, or set up a checkout by hand)."
  say "cloning $REPO into $DIR"
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
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-"$1"; }
fernet() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n'; }
origin=""
if command -v tailscale >/dev/null 2>&1; then
  host=$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -n 1)
  [ -n "$host" ] && origin="https://$host"
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
  sed -i '/^COMPOSE_FILE=/d' .env
  printf 'COMPOSE_FILE=%s\n' "$files" >> .env
  [ "$files" = docker-compose.yml ] || say "extension services: ${files#docker-compose.yml:}"
}
compose_files

# 3. extensions: copied from the extensions repo by the same `ext` CLI Claude uses, in the claude image
# (node + git, runs as the checkout owner).
if [ -n "$EXTENSIONS" ]; then
  say "building the claude image to install extensions: $EXTENSIONS"
  $DC build --quiet claude
  # shellcheck disable=SC2086 # one word per extension id
  $DC run --rm --no-deps -T --entrypoint node claude scripts/ext.mjs install $EXTENSIONS
  compose_files
fi

# 4. start
say "building and starting (the first run takes a few minutes)"
$DC up -d --build --remove-orphans

# 5. tailnet
if command -v tailscale >/dev/null 2>&1; then
  if tailscale serve --bg "$PORT" >/dev/null 2>&1 || sudo tailscale serve --bg "$PORT" >/dev/null 2>&1; then
    say "published on your tailnet: $origin"
  else
    say "could not run 'tailscale serve --bg $PORT'; run it yourself to reach the app over HTTPS"
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
token=$(sed -n 's/^SETUP_TOKEN=//p' .env)
cat <<NEXT

  Open:        $(sed -n 's/^PUBLIC_ORIGIN=//p' .env)/setup
  Setup code:  $token
$( [ "$origin" = "http://localhost:$PORT" ] && echo "  (No Tailscale found: from your computer run  ssh -L $PORT:localhost:$PORT <this-host>  and open http://localhost:$PORT/setup)")

  Then, in a terminal on this host (in $DIR), or the app's terminal once it is set up:
    $DC exec -it claude claude                        # /login once, Remote Control starts by itself
$( [ -f extensions/health/compose.yml ] && echo "    $DC exec -it garmin-sync python -m sync login     # health: connect Garmin (password never stored)")

  Add apps later:  $DC exec claude node scripts/ext.mjs available   (then: ext.mjs install <id>, ./install.sh)

NEXT
