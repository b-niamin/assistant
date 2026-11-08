#!/bin/sh
# beni: one command for everything you do with the assistant on the host. Run it in the checkout.
#
#   ./beni.sh install [ext...]      install or re-run the installer (asks in a terminal; see install.sh)
#   ./beni.sh update                git pull, then the installer again (keeps .env, extensions, answers)
#   ./beni.sh start | stop | restart [service]
#   ./beni.sh status                containers and the app's health
#   ./beni.sh logs [service]        follow logs (web, claude, garmin-sync, ...)
#   ./beni.sh ext <args>            the extension CLI in the claude container: available, install <id>, list, ...
#   ./beni.sh migrate <old-checkout> [--no-garmin-login]   copy data from an older install (after a backup)
#   ./beni.sh fix-permissions       owner, Synology ACLs and modes in the checkout
#   ./beni.sh auto-update [install | status]
#
# Docker on Synology needs root: put sudo in front (sudo ./beni.sh status).
set -eu
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Tailscale/target/bin
DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

say() { printf '  \033[2m·\033[0m %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else DC=""; fi
# Compose with the folder, .env and files spelled out (COMPOSE_FILE in .env lists the extensions' ones).
dc() {
  [ -n "$DC" ] || die "Docker Compose is missing."
  [ -f .env ] || die "not installed yet: ./beni.sh install"
  set -- --project-directory "$DIR" --env-file "$DIR/.env" \
    $(sed -n 's/^COMPOSE_FILE=//p' .env | tr ':' '\n' | sed 's/^/-f /') "$@"
  $DC "$@"
}
envv() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }

usage() { sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; }

cmd=${1:-help}
[ $# -gt 0 ] && shift
case $cmd in
  install) exec sh ./install.sh "$@" ;;
  update)
    git pull --ff-only || die "git pull failed (local changes? run: git status)"
    exec sh ./install.sh ;;
  start) dc up -d "$@" && ok "started" ;;
  stop) dc stop "$@" && ok "stopped (data kept)" ;;
  restart) dc restart "$@" && ok "restarted" ;;
  status)
    dc ps --format 'table {{.Service}}\t{{.Status}}'
    port=$(envv WEB_PORT)
    if curl -fs -o /dev/null "http://127.0.0.1:${port:-3000}/healthz" 2>/dev/null; then ok "app answers on port ${port:-3000}: $(envv PUBLIC_ORIGIN)"
    else say "app not answering on port ${port:-3000} yet (building? ./beni.sh logs web)"; fi ;;
  logs) dc logs -f --tail 100 "$@" ;;
  ext) dc exec claude node scripts/ext.mjs "$@" ;;
  migrate) exec sh scripts/import-legacy.sh "$@" ;;
  fix-permissions) exec sh scripts/auto-update.sh fix-permissions "$DIR" ;;
  auto-update)
    case ${1:-status} in
      install) exec sh scripts/auto-update.sh install "$DIR" ;;
      status) exec sh scripts/auto-update.sh status "$DIR" ;;
      *) die "auto-update install | status" ;;
    esac ;;
  help | -h | --help) usage ;;
  *) usage; exit 1 ;;
esac
