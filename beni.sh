#!/bin/sh
# beni: one command for everything you do with the assistant on the host. Run it in the checkout.
#
#   ./beni.sh install [ext...]      install or re-run the installer (asks in a terminal; see install.sh)
#   ./beni.sh update                update to GitHub main now, with a progress bar (the same command the
#                                   schedule runs: <folder>-updater/update.sh); a running update is followed
#   ./beni.sh update --status       what the updater does or did; --cancel stops a running update;
#                                   --restart also restarts the terminal when it waits for it
#   ./beni.sh start | stop | restart [service]
#   ./beni.sh status                containers and the app's health
#   ./beni.sh doctor                checks the install: permissions, git, .env, database password, ...
#   ./beni.sh logs [service]        follow logs (web, terminal, garmin-sync, ...)
#   ./beni.sh ext <args>            the extension CLI in the terminal container: available, install <id>, list, ...
#   ./beni.sh fix-permissions       owner, Synology ACLs and modes in the checkout
#   ./beni.sh fix-db-password       the database keeps its data but takes the password in .env
#   ./beni.sh move <new-folder>     move the install (stopped, data kept), e.g. to /volume1/docker/assistant
#   ./beni.sh backup [--list]       make a backup now (database, .env, extensions) | list them
#   ./beni.sh restore <backup>      bring a backup back (also on a new machine, after ./beni.sh install)
#   ./beni.sh auto-update [install | status]   set up the updater and its schedule (once) | status
#
# Docker on Synology needs root: put sudo in front (sudo ./beni.sh status).
set -eu
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Tailscale/target/bin
DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

say() { printf '  \033[2m·\033[0m %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else DC=""; fi
# Compose with the folder, .env and files spelled out (COMPOSE_FILE in .env lists the extensions' ones).
dc() {
  [ -n "$DC" ] || die "Docker Compose is missing."
  [ -f .env ] || die "not installed yet: ./beni.sh install"
  [ -r .env ] || die "cannot read .env (it belongs to root): put sudo in front"
  set -- -p "$(project)" --project-directory "$DIR" --env-file "$DIR/.env" \
    $(sed -n 's/^COMPOSE_FILE=//p' .env | tr ':' '\n' | while IFS= read -r f; do [ ! -f "$f" ] || echo "-f $f"; done) "$@"
  $DC "$@"
}
envv() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }
# The compose project name (volumes and containers are prefixed with it): COMPOSE_PROJECT_NAME in .env,
# which install.sh pins, else the folder name, as Compose normalizes it.
project() {
  p=$(envv COMPOSE_PROJECT_NAME)
  printf '%s\n' "${p:-$(basename "$DIR")}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_\n-'
}

# The containers write the checkout as HOST_UID (from .env, else the folder's owner).
owner_uid() {
  u=$(envv HOST_UID | tr -cd 0-9)
  echo "${u:-$(stat -c %u "$DIR")}"
}
# Runs a command as the checkout owner. git run as root writes root-owned objects, which the claude
# container (and a later `git pull` by the owner) cannot replace, and newer git refuses a repo that is
# not root's ("dubious ownership").
as_owner() {
  u=$(owner_uid)
  if [ "$(id -u)" = "$u" ]; then "$@"
  elif [ "$(id -u)" = 0 ] && command -v sudo >/dev/null 2>&1; then sudo -n -H -u "#$u" "$@"
  else "$@"; fi
}

usage() { sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'; }

# --- the database password ----------------------------------------------------------------------
# A database volume keeps the password it was created with. A new .env (a fresh clone into the same
# folder name, a lost .env) has another one, and migrate then fails with "password authentication failed".
db_running() { [ -n "$(dc ps -q --status running db 2>/dev/null)" ]; }
db_wait() {
  n=0
  until dc exec -T db pg_isready -q >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -le 60 ] || return 1; sleep 1
  done
}
# 0 = POSTGRES_PASSWORD opens the database, 1 = it does not, 2 = could not tell. The password goes in
# on stdin, never on a command line. It connects over the network (host "db"): Postgres trusts the
# local socket and 127.0.0.1 without a password, so only there would a wrong password show.
db_check() {
  db_running || return 2
  db_wait || return 2
  out=$(envv POSTGRES_PASSWORD | dc exec -T db sh -c \
    'IFS= read -r PGPASSWORD; export PGPASSWORD; psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" 2>&1' 2>&1) || true
  case $out in
    1) return 0 ;;
    *"password authentication failed"*) return 1 ;;
    *) return 2 ;;
  esac
}
db_mismatch_help() {
  cat >&2 <<HELP
    The database (volume $(project)_db-data) was created with another POSTGRES_PASSWORD than the one in .env.
    Either:
      - put back the .env of the install that made this database, then: sudo ./beni.sh start
      - or keep the data and give the database the password in .env:   sudo ./beni.sh fix-db-password
        (extension secrets and Garmin logins were encrypted with the old .env: enter them again)
      - or start with an empty database (deletes all data; backups stay in $(backup_dir)):
          sudo ./beni.sh stop && sudo docker compose -p $(project) rm -f db && sudo docker volume rm $(project)_db-data
HELP
}

fix_db_password() {
  dc up -d --no-deps db >/dev/null 2>&1 || die "cannot start the db container"
  db_wait || die "the database does not answer (./beni.sh logs db)"
  if db_check; then ok "the database already takes the password in .env"; return 0; fi
  if [ -t 0 ] && [ "${ASSISTANT_YES:-0}" != 1 ]; then
    printf '  The database keeps its data and its password becomes the one in .env. Go on? (y/n) '
    read -r a; case $a in [yY]*) ;; *) die "nothing changed" ;; esac
  fi
  # The container's own socket trusts its superuser, so no old password is needed. migrate then
  # sets the other roles' passwords from .env as it always does.
  envv POSTGRES_PASSWORD | dc exec -T db sh -c '
    IFS= read -r pw
    printf "%s\n" "SELECT format('"'"'ALTER ROLE %I PASSWORD %L'"'"', current_user, :'"'"'pw'"'"') \\gexec" |
      psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$pw" >/dev/null' ||
    die "could not change the password"
  db_check || die "changed it, but .env still does not open the database"
  ok "the database takes the password in .env now; starting the rest"
  dc up -d
}

# --- doctor -------------------------------------------------------------------------------------
doctor() {
  fails=0 warns=0
  f() { bad "$*"; fails=$((fails + 1)); }
  w() { warn "$*"; warns=$((warns + 1)); }
  printf '\n\033[1mChecking %s\033[0m\n' "$DIR"
  is_root=no; [ "$(id -u)" = 0 ] && is_root=yes
  # The default folder used to be called assistant-core.
  if [ "$(basename "$DIR")" = assistant-core ] && [ ! -e "$(dirname "$DIR")/assistant" ]; then
    say "the default folder is now $(dirname "$DIR")/assistant; to move this install (data kept): sudo ./beni.sh move $(dirname "$DIR")/assistant"
  fi

  # Docker
  docker_ok=no
  if [ -z "$DC" ]; then f "Docker Compose is missing"
  elif docker info >/dev/null 2>&1; then docker_ok=yes; ok "Docker and Compose answer"
  else f "cannot talk to Docker: put sudo in front (Synology), or join the docker group"; fi

  # .env
  env_ok=no
  if [ ! -f .env ]; then f ".env is missing: not installed yet (./beni.sh install)"
  elif [ ! -r .env ]; then f "cannot read .env (it belongs to $(stat -c %U .env)): put sudo in front"
  else
    env_ok=yes
    missing=""
    for k in POSTGRES_PASSWORD APP_DB_PASSWORD CLAUDE_DB_PASSWORD SERVICES_DB_PASSWORD TOKEN_ENCRYPTION_KEY \
      SECRETS_KEY SIDECAR_TICKET_SECRET CLAUDE_TOOLS_TOKEN PUBLIC_ORIGIN HOST_UID; do
      [ -n "$(envv "$k")" ] || missing="$missing $k"
    done
    if [ -n "$missing" ]; then f ".env has no value for:$missing (re-run ./beni.sh install, it adds missing secrets)"
    else ok ".env has every secret"; fi
    grep -q '^INSTALLED_AT=' .env || w "the installer did not finish last time: sudo ./beni.sh install"
    case $(stat -c %a .env) in 600 | 400) ;; *) w ".env is readable by others (mode $(stat -c %a .env)): chmod 600 .env" ;; esac
  fi

  # Files: the containers (web, terminal) write the checkout as HOST_UID.
  uid=$(owner_uid)
  [ "$uid" != 0 ] || f "HOST_UID is 0: the containers would run as root; set it to the owner's uid (id -u)"
  [ "$(stat -c %u "$DIR")" = "$uid" ] || w "the folder belongs to uid $(stat -c %u "$DIR"), the containers run as $uid (HOST_UID)"
  if [ "$is_root" = yes ] || [ "$(id -u)" = "$uid" ]; then
    f0=$fails
    n=$(find "$DIR" -xdev ! -user "$uid" ! -path "$DIR/.env" 2>/dev/null | grep -c . || true)
    [ "$n" = 0 ] || f "$n file(s) do not belong to uid $uid (left by a run as root?): sudo ./beni.sh fix-permissions"
    n=$(find "$DIR" -xdev ! -path "$DIR/.env" ! -path "$DIR/.git/objects/*" ! -type l \
      \( ! -perm -u+rw -o -type d ! -perm -u+x \) 2>/dev/null | grep -c . || true)
    m=$(find "$DIR/.git/objects" -xdev \( -type d ! -perm -u+rwx \) -o \( -type f ! -perm -u+r \) 2>/dev/null | grep -c . || true)
    [ "$((n + m))" = 0 ] || f "$((n + m)) path(s) the owner cannot write (git pull and Claude would fail): sudo ./beni.sh fix-permissions"
    if command -v synoacltool >/dev/null 2>&1; then
      n=$(find "$DIR" -xdev ! -path "$DIR/.env" -exec ls -dln {} + 2>/dev/null | sh scripts/update.sh acl-paths | grep -c . || true)
      [ "$n" = 0 ] || f "$n path(s) carry a Synology ACL (they deny writes): sudo ./beni.sh fix-permissions"
    fi
    [ "$fails" != "$f0" ] || ok "the checkout belongs to uid $uid and it can write all of it"
  else
    say "file checks skipped: run as uid $uid or with sudo"
  fi

  # git, as the owner
  if ! as_owner git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
    f "git does not work in the checkout: $(as_owner git -C "$DIR" status 2>&1 | head -n 1)"
  else
    br=$(as_owner git -C "$DIR" symbolic-ref --short -q HEAD || echo detached)
    [ "$br" = main ] || w "the checkout is on $br, not main: auto-update pauses"
    ch=$(as_owner git -C "$DIR" status --porcelain --untracked-files=no | grep -c . || true)
    [ "$ch" = 0 ] || w "$ch tracked file(s) changed locally (git status): updates stop if they clash"
    if as_owner git -C "$DIR" fetch -q origin main 2>/dev/null; then
      ahead=$(as_owner git -C "$DIR" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
      behind=$(as_owner git -C "$DIR" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
      [ "$ahead" = 0 ] || w "$ahead local commit(s) are not on GitHub: auto-update pauses until they are pushed"
      if [ "$behind" = 0 ]; then ok "git works and the checkout is up to date with GitHub main"
      else w "$behind commit(s) behind GitHub main: sudo ./beni.sh update"; fi
    else
      w "git fetch failed (network, or the remote): $(as_owner git -C "$DIR" remote get-url origin 2>/dev/null)"
    fi
  fi

  [ "$env_ok" = yes ] || { doctor_end; return; }

  # Compose files
  cf_ok=yes
  for p in $(envv COMPOSE_FILE | tr ':' ' '); do
    case $p in /*) ;; *) w "COMPOSE_FILE has a relative path ($p); re-run ./beni.sh install" ;; esac
    # An extension whose service moved to the worker (or that was removed) leaves its old entry: harmless.
    [ -f "$p" ] || w "COMPOSE_FILE lists $p, which is gone (skipped): sudo ./beni.sh install tidies it"
  done
  if [ -f extensions/installed.json ]; then
    for id in $(grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-z][a-z0-9-]*"' extensions/installed.json | sed -E 's/.*"([a-z0-9-]+)"$/\1/'); do
      [ ! -f "extensions/$id/compose.yml" ] || envv COMPOSE_FILE | grep -q "extensions/$id/compose.yml" ||
        { w "extension $id brings a service that is not in the stack: sudo ./beni.sh install"; cf_ok=no; }
    done
  fi
  if [ "$docker_ok" = yes ]; then
    if err=$(dc config -q 2>&1); then [ "$cf_ok" = no ] || ok "the compose files are valid"
    else f "docker compose config fails: $(printf '%s' "$err" | tail -n 1)"; fi
  fi

  # Started by Container Manager & co. from stack/
  if [ "$(envv START_MODE)" = manual ]; then
    if [ ! -f stack/docker-compose.yml ]; then f "stack/docker-compose.yml is missing: sudo ./beni.sh install"
    else
      for src in $(envv COMPOSE_FILE | tr ':' ' '); do
        if [ "$src" -nt stack/docker-compose.yml ]; then
          w "stack/docker-compose.yml is older than $src: sudo ./beni.sh install, then rebuild the project in Container Manager"
          break
        fi
      done
      if [ -d /volume1 ]; then
        for s in stack stack/docker-compose.yml stack/.env; do
          [ -e "$s" ] && [ "$(($(stat -c %a "$s" | tail -c 2) & 4))" -ne 0 ] ||
            f "$s is not readable by Container Manager: sudo ./beni.sh install"
        done
      fi
    fi
  fi

  # Containers and the database
  if [ "$docker_ok" = yes ]; then
    p=$(project)
    other=$(docker ps -a --filter "label=com.docker.compose.project=$p" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null |
      grep -v -x -e "$DIR" -e "$DIR/stack" | sort -u | head -n 1)
    [ -z "$other" ] || f "the compose project $p is also used by $other: both installs share containers and volumes (set COMPOSE_PROJECT_NAME in one .env, or ./beni.sh move one of them)"
    if docker volume inspect "${p}_db-data" >/dev/null 2>&1; then
      db_check && rc=0 || rc=$?
      case $rc in
        0)
          ok "POSTGRES_PASSWORD in .env opens the database"
          # Extensions whose data is in the database but whose folder is not here (a fresh clone).
          lost=""
          for id in $(dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT DISTINCT split_part(name, '"'"'/'"'"', 1) FROM core.schema_migrations WHERE name LIKE '"'"'%/%'"'"'"' 2>/dev/null); do
            [ -f "extensions/$id/extension.json" ] || lost="$lost $id"
          done
          [ -z "$lost" ] || w "the database has data of extensions that are not installed here:$lost (sudo ./beni.sh install$lost)" ;;
        1) f "the database was made with another password than the one in .env"; db_mismatch_help 2>&1; helped=yes ;;
        2) say "database password not checked (db not running: sudo ./beni.sh start)" ;;
      esac
    else
      say "no database yet (volume ${p}_db-data): it is made on the first start"
    fi
    mig=$(docker ps -a -q --filter "label=com.docker.compose.project=$p" --filter label=com.docker.compose.service=migrate | head -n 1)
    if [ -n "$mig" ]; then
      code=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$mig")
      case $code in
        "exited 0") ok "migrate finished" ;;
        running*) say "migrate is running" ;;
        *)
          if docker logs "$mig" 2>&1 | grep -q "password authentication failed"; then
            f "migrate failed: password authentication failed"; [ "${helped:-}" = yes ] || db_mismatch_help 2>&1
          else f "migrate failed ($code): sudo ./beni.sh logs migrate"; fi ;;
      esac
    fi
    down=$(dc ps -a --format '{{.Service}} {{.State}}' 2>/dev/null | awk '$1 != "migrate" && $2 != "running" { print $1 "(" $2 ")" }' | xargs)
    if [ -z "$(dc ps -a -q 2>/dev/null)" ]; then w "no containers: sudo ./beni.sh start"
    elif [ -n "$down" ]; then f "not running: $down (sudo ./beni.sh logs <service>)"
    else ok "every service runs"; fi
    port=$(envv WEB_PORT)
    if curl -fs -o /dev/null "http://127.0.0.1:${port:-3000}/healthz" 2>/dev/null; then ok "the app answers on port ${port:-3000}"
    else w "the app does not answer on port ${port:-3000} (still building? sudo ./beni.sh logs web)"; fi
  fi

  # Backups
  bdir=$(backup_dir)
  case $bdir/ in "$DIR"/*) w "BACKUP_DIR ($bdir) is inside the checkout, where the terminal can read the .env in each backup: move it next to the checkout" ;; esac
  last=$(ls -1d "$bdir"/beni-* 2>/dev/null | sort | tail -n 1)
  if [ -z "$last" ]; then w "no backup in $bdir yet (sudo ./beni.sh backup)"
  elif [ -n "$(find "$last" -maxdepth 0 -mmin +2160 2>/dev/null)" ]; then w "the last backup is more than 36 hours old: $last (sudo ./beni.sh logs backup)"
  else ok "last backup: $(basename "$last") in $bdir"; fi

  # Updater
  home=$(updater_home)
  if [ ! -f "$home/update.sh" ] && [ ! -f "$home/auto-update.sh" ]; then say "the updater is not set up (sudo ./beni.sh auto-update install)"
  else
    st=$(sed -n 's/.*"status":"\([^"]*\)".*"message":"\([^"]*\)".*/\1: \2/p' "$home/status.json" 2>/dev/null | head -n 1)
    case $st in
      ok:* | updating:* | available:*) ok "updater: ${st#*: }" ;;
      "") ok "the updater is set up ($home)" ;;
      *) w "updater $st (sudo ./beni.sh update --status)" ;;
    esac
    # Each run leaves a timestamp; none for 15 minutes means the schedule does not run it.
    mp=$(docker volume inspect -f '{{.Mountpoint}}' "$(project)_logs" 2>/dev/null || true)
    if [ -n "$mp" ] && [ -f "$mp/updater-heartbeat" ] && [ -n "$(find "$mp/updater-heartbeat" -mmin -15 2>/dev/null)" ]; then
      ok "the updater ran in the last 15 minutes"
    elif [ -n "$mp" ]; then
      w "the updater has not run in the last 15 minutes: the schedule must run  sh $home/update.sh  (as root, every minute; DSM: last run time 23:59, not 00:59)"
    fi
  fi
  doctor_end
}
# --- move ---------------------------------------------------------------------------------------
# The containers bind-mount the checkout and COMPOSE_FILE / stack/ hold absolute paths, so a move stops
# the stack, moves the folder (and the updater home next to it) and runs the installer in the new place.
# The compose project name is pinned in .env first: the containers and volumes keep their names, so the
# data stays where it is.
move_to() {
  [ "$(id -u)" = 0 ] || die "run it with sudo"
  [ -n "${1:-}" ] || die "usage: sudo ./beni.sh move <new folder>"
  [ -f .env ] || die "not installed yet: ./beni.sh install"
  parent=$(cd "$(dirname "$1")" 2>/dev/null && pwd -P) || die "$(dirname "$1") does not exist"
  new=$parent/$(basename "$1")
  [ "$new" != "$DIR" ] || die "the install is already in $new"
  [ ! -e "$new" ] || die "$new exists already"
  case "$new/" in "$DIR"/*) die "cannot move the install into itself" ;; esac
  p=$(project)
  if ! grep -q '^COMPOSE_PROJECT_NAME=.' .env; then
    sed -i '/^COMPOSE_PROJECT_NAME=/d' .env
    printf 'COMPOSE_PROJECT_NAME=%s\n' "$p" >> .env
  fi
  say "compose project $p: same containers and volumes, so the same data"
  dc down && ok "stopped (data kept)"
  new_home=""
  if [ -z "${ASSISTANT_UPDATER_HOME:-}" ]; then
    old_home=$(dirname "$DIR")/$(basename "$DIR")-updater
    new_home=$parent/$(basename "$new")-updater
    if [ -d "$old_home" ] && [ ! -e "$new_home" ]; then
      mv "$old_home" "$new_home" && ok "updater home: $new_home"
      if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF "$old_home/"; then
        crontab -l 2>/dev/null | grep -vF "$old_home/" | crontab - && say "removed the old cron entry"
      fi
      rm -f "$new_home/checkout" # install.sh writes the new one
    fi
  fi
  mv "$DIR" "$new" && ok "moved to $new"
  cd "$new"
  if [ -f /etc/synoinfo.conf ] && [ -n "$new_home" ] && [ -d "$new_home/mirror.git" ]; then
    warn "DSM Task Scheduler: change the update task's command to the one the installer prints below"
  fi
  [ "$(envv START_MODE)" != manual ] ||
    warn "Container Manager: delete the project $p (keep its data) and create it again from $new/stack"
  ASSISTANT_YES=1 exec sh ./install.sh
}

doctor_end() {
  printf '\n'
  if [ "$fails" -gt 0 ]; then bad "$fails problem(s), $warns warning(s)"; return 1; fi
  if [ "$warns" -gt 0 ]; then warn "no problems, $warns warning(s)"; else ok "all good"; fi
}

# --- backup and restore ---------------------------------------------------------------------------
# Backups are folders beni-<day>_<time> in BACKUP_DIR (db/backup.sh): db.dump, env, extensions.tgz.
backup_dir() {
  b=$(envv BACKUP_DIR); b=${b:-../assistant-backups}
  case $b in /*) ;; *) b=$DIR/$b ;; esac
  (cd "$b" 2>/dev/null && pwd) || echo "$b"
}

backup_now() {
  if [ "${1:-}" = --list ]; then
    ls -1d "$(backup_dir)"/beni-* 2>/dev/null | sort -r || say "no backups in $(backup_dir)"
    return 0
  fi
  dc run --rm -T backup now || die "the backup failed (./beni.sh logs backup, /logs/backup.log)"
  ok "backup made in $(backup_dir)"
}

# Keys that encrypt data in the database: they have to come back with it.
RESTORE_KEYS="SECRETS_KEY TOKEN_ENCRYPTION_KEY APP_PASSWORD_HASH"

restore() {
  src=${1:-}
  [ -n "$src" ] || die "restore <backup folder>   (sudo ./beni.sh backup --list)"
  case $src in /*) ;; *) [ -d "$src" ] || src=$(backup_dir)/$src ;; esac
  [ -f "$src/db.dump" ] || die "$src has no db.dump"
  [ -f .env ] || die "install first (./beni.sh install), then restore into it"
  stamp=$(date +%Y%m%d-%H%M%S)
  say "restoring $src"
  [ -f "$src/manifest.json" ] && say "$(cat "$src/manifest.json")"
  if [ -t 0 ] && [ "${ASSISTANT_YES:-0}" != 1 ]; then
    printf '  This REPLACES the database%s with the backup. Go on? (y/n) ' "$( [ -f "$src/extensions.tgz" ] && echo ' and the installed extensions')"
    read -r a; case $a in [yY]*) ;; *) die "nothing changed" ;; esac
  fi
  # Safety net: the current state first, unless there is nothing to keep.
  if db_running; then dc run --rm -T backup now >/dev/null 2>&1 && ok "made a backup of the current state first" || warn "could not back up the current state"; fi

  # .env: this machine keeps its own passwords, ports and address; the keys come from the backup.
  if [ -f "$src/env" ]; then
    cp -p .env ".env.before-restore-$stamp"
    for k in $RESTORE_KEYS; do
      v=$(sed -n "s/^$k=//p" "$src/env" | tail -n 1)
      [ -n "$v" ] || continue
      if grep -q "^$k=" .env; then
        tmp=$(mktemp) && awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
      else printf '%s=%s
' "$k" "$v" >> .env; fi
    done
    ok "keys from the backup's .env ($RESTORE_KEYS); the old .env is .env.before-restore-$stamp"
  else warn "the backup has no .env: secrets stored in it cannot be decrypted (enter them again)"; fi

  dc stop >/dev/null 2>&1 || true

  # Extensions: the current ones go to extensions/.trash, the backup's come in.
  if [ -f "$src/extensions.tgz" ]; then
    mkdir -p "extensions/.trash/before-restore-$stamp"
    for e in extensions/* extensions/installed.json; do
      [ -e "$e" ] || continue
      case $e in extensions/README.md) continue ;; esac
      mv "$e" "extensions/.trash/before-restore-$stamp/" 2>/dev/null || true
    done
    tar -xzf "$src/extensions.tgz" -C "$DIR" || die "could not unpack the extensions"
    u=$(owner_uid); chown -R "$u" extensions 2>/dev/null || true
    ok "extensions restored (the previous ones are in extensions/.trash/before-restore-$stamp)"
  fi

  # Database: a fresh one, the dump without owners and grants (migrate puts back roles and owners).
  dc up -d --no-deps db >/dev/null || die "cannot start the db container"
  db_wait || die "the database does not answer (./beni.sh logs db)"
  dc exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"' ||
    die "could not recreate the database"
  if dc exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' < "$src/db.dump"; then ok "database restored"
  else warn "pg_restore reported problems (above); the data that loaded is there"; fi
  # Without owners, the ext_query functions (SECURITY DEFINER) now belong to the superuser and anyone may
  # call them: take that away; migrate gives each installed extension's back to its own role.
  dc exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ext_query FROM PUBLIC"' >/dev/null 2>&1 || true
  dc up -d || die "could not start the stack"
  ok "started; migrate re-applies the roles. Check: ./beni.sh status"
}

# The updater's home: next to the checkout, outside it (spec 006).
updater_home() { echo "${ASSISTANT_UPDATER_HOME:-$(dirname "$DIR")/$(basename "$DIR")-updater}"; }

cmd=${1:-help}
[ $# -gt 0 ] && shift
case $cmd in
  install) exec sh ./install.sh "$@" ;;
  update)
    # One update path for everyone: the updater in <folder>-updater, the same one the schedule runs
    # (never this checkout's copy, which the containers can change). Set up on first use.
    home=$(updater_home)
    if [ ! -f "$home/update.sh" ]; then
      [ "${1:-}" != --status ] && [ "${1:-}" != --cancel ] || die "the updater is not set up: sudo ./beni.sh update"
      sh scripts/update.sh install "$DIR" || die "could not set up the updater"
    fi
    case ${1:-} in
      --status) exec sh "$home/update.sh" status "$DIR" ;;
      --cancel) exec sh "$home/update.sh" cancel "$DIR" ;;
      "") exec sh "$home/update.sh" run --now "$DIR" ;;
      --restart) exec sh "$home/update.sh" run --restart "$DIR" ;;
      *) die "update [--status | --cancel | --restart]" ;;
    esac ;;
  start) dc up -d "$@" && ok "started" ;;
  stop) dc stop "$@" && ok "stopped (data kept)" ;;
  restart) dc restart "$@" && ok "restarted" ;;
  status)
    dc ps --format 'table {{.Service}}\t{{.Status}}'
    port=$(envv WEB_PORT)
    if curl -fs -o /dev/null "http://127.0.0.1:${port:-3000}/healthz" 2>/dev/null; then ok "app answers on port ${port:-3000}: $(envv PUBLIC_ORIGIN)"
    else say "app not answering on port ${port:-3000} yet (building? ./beni.sh logs web)"; fi ;;
  doctor) doctor ;;
  # For install.sh: does .env open the existing database? (exit 1 = it does not)
  check-db)
    db_check && rc=0 || rc=$?
    [ "$rc" != 1 ] || { db_mismatch_help; exit 1; }
    exit 0 ;;
  fix-db-password) fix_db_password ;;
  logs) dc logs -f --tail 100 "$@" ;;
  ext) dc exec terminal node scripts/ext.mjs "$@" ;;
  move) move_to "$@" ;;
  backup) backup_now "$@" ;;
  restore) restore "$@" ;;
  fix-permissions) exec sh scripts/update.sh fix-permissions "$DIR" ;;
  auto-update)
    case ${1:-status} in
      install) exec sh scripts/update.sh install "$DIR" ;;
      status) exec sh scripts/update.sh status "$DIR" ;;
      *) die "auto-update install | status" ;;
    esac ;;
  help | -h | --help) usage ;;
  *) usage; exit 1 ;;
esac
