#!/bin/sh
# The updater: brings this install to GitHub main (spec 006). One command, on the host:
#
#   sh <home>/update.sh               in a terminal: update now, with a progress bar
#                                     from cron / DSM Task Scheduler (every minute, as root): check GitHub,
#                                     update when automatic updates are on or the app asked for one, and
#                                     finish an update that was interrupted
#   sh <home>/update.sh --now         update now, also without a terminal (and retry a failed update)
#   sh <home>/update.sh --restart     the same, and restart llm/terminal if they wait for it (see HELD)
#   sh <home>/update.sh status        what it does or did (--json: the raw status)
#   sh <home>/update.sh cancel        stop a running update; the containers that ran before keep running
#   sh scripts/update.sh install      once: <home> with a mirror of GitHub and this script, and the schedule
#   sh scripts/update.sh fix-permissions | plan | acl-paths
#
# <home> is <checkout>-updater, next to the checkout. `sudo ./beni.sh update [--status|--cancel|--restart]` runs it.
#
# It runs on the HOST, never in a container: no container gets the Docker socket (spec 004). What it
# runs comes only from a private mirror of GitHub main in <home>, which no container can see: this script
# updates its copy there from the mirror, never from the checkout. The checkout (that Claude edits) is
# only touched inside a throwaway container (`--network none`, only the checkout mounted), so a hook or a
# git config written into it cannot run on the host. Images are built from the mirror's copy of docker/
# and docker-compose.yml, not from the checkout.
#
# An update is a list of steps, each with a time limit: build the images that changed (old containers keep
# running), fast-forward the checkout, start what was rebuilt, migrate, restart, check the services. The
# steps done are journaled in <home>/state: an update that died (reboot, kill) is picked up by the next run
# and skips them. A lock (<home>/lock: pid, its start time and the boot) keeps one update at a time; one
# whose process is gone is taken over at once.
#
# Output: <home>/status.json and, for the app, /logs/updater-status.json, /logs/updater.log,
# /logs/updater-build.log and /logs/updater-heartbeat (written every few seconds while an update runs).
set -u
PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:/var/packages/ContainerManager/target/usr/bin:${PATH:-}
umask 022

BRANCH=${ASSISTANT_BRANCH:-main}
FETCH_EVERY=${ASSISTANT_FETCH_EVERY:-240}         # seconds between GitHub checks when nothing is asked for
BUILD_TIMEOUT=${ASSISTANT_BUILD_TIMEOUT:-5400}    # one image build (NAS builds are slow)
STEP_TIMEOUT=${ASSISTANT_STEP_TIMEOUT:-900}       # any other step
MAX_ATTEMPTS=3                                    # an interrupted or failed update is tried this often
# Recreating or restarting these ends what runs in them (Claude and Codex sessions, the terminal): with
# restarts=ask (the default, System settings -> Updates) the update leaves them to a confirmed restart.
HELD=${ASSISTANT_HELD_SERVICES:-llm terminal}

say() { printf '[update] %s\n' "$*"; }
# An error also lands in <home>/last-error and the app's updater.log: a scheduled task's output is
# seen by nobody.
die() {
  printf '[update] %s\n' "$*" >&2
  h=${HOME_DIR:-$(cd "$(dirname "$0")" 2>/dev/null && pwd)}
  case $h in *-updater) printf '%s %s\n' "$(iso)" "$*" > "$h/last-error" 2>/dev/null || true ;; esac
  [ -z "${LOGS_MP:-}" ] || printf '%s %s\n' "$(iso)" "$*" | logs_put updater.log append
  exit 1
}
now() { date -u +%s; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
short() { printf '%.7s' "$1"; }

# --- plan: changed paths (stdin) -> actions (stdout, one per line) --------------------------------
# all              docker-compose.yml changed: build every image, `up -d` the whole project
# build:<svc>      rebuild that image and recreate the service
# restart:<svc>    the service runs long-lived code from the checkout: restart it
# migrate          re-run the one-shot migrate service (roles, migrate.sh)
# Everything else is live without help: apps/web (live-reload), db/migrations (ext-migrate), docs.
# Extensions are not in this repo: `ext update` changes them, and live-reload/ext-migrate pick that up.
plan() {
  while IFS= read -r p; do
    case $p in
      docker-compose.yml) echo all ;;
      docker/llm/*) echo build:llm; echo build:terminal ;;
      docker/browser/*) echo build:browser ;;
      apps/web/scripts/live-reload.mjs) echo restart:web ;;
      services/terminal/*.test.mjs) ;;
      services/terminal/*) echo restart:terminal ;;
      db/watch-extensions.sh) echo restart:ext-migrate ;;
      db/migrate.sh | db/roles.sql | db/extension-role.sql) echo migrate; echo restart:ext-migrate ;;
      db/backup.sh) echo restart:backup ;;
    esac
  done | awk '!seen[$0]++'
}

# `ls -dln` lines (stdin) -> paths that carry an ACL (mode ends in "+"), one per line.
acl_paths() { awk '$1 ~ /\+$/ { for (i = 0; i < 8; i++) sub(/^[^ ]+ +/, ""); print }'; }

# --- paths -----------------------------------------------------------------------------------------
# The checkout: the argument, else the one this home serves (<home>/checkout, or <checkout>-updater's
# name), else the one around scripts/.
setup_paths() {
  d=${1:-}
  here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
  [ -n "$d" ] || [ ! -f "$here/checkout" ] || d=$(cat "$here/checkout")
  case $here in *-updater) [ -n "$d" ] || [ ! -d "$here/mirror.git" ] || d=${here%-updater} ;; esac
  [ -n "$d" ] || d=$(cd "$here/.." 2>/dev/null && pwd)
  [ -f "$d/docker-compose.yml" ] && [ -d "$d/.git" ] || die "not an assistant checkout: $d"
  DIR=$(cd "$d" && pwd -P)
  # The containers that edit the checkout (web, claude, terminal) run as HOST_UID from .env, so that
  # uid owns the checkout, whoever owns the directory itself (a clone made as root, say).
  OWNER_UID=$(sed -n 's/^HOST_UID=\([0-9][0-9]*\)[[:space:]]*$/\1/p' "$DIR/.env" 2>/dev/null | tail -n 1)
  [ -n "$OWNER_UID" ] || OWNER_UID=$(stat -c %u "$DIR")
  OWNER_GID=$(awk -F: -v u="$OWNER_UID" '$3 == u { print $4; exit }' /etc/passwd 2>/dev/null)
  [ -n "$OWNER_GID" ] || OWNER_GID=$(stat -c %g "$DIR")
  # COMPOSE_PROJECT_NAME in .env (install.sh pins it), else the folder name, as Compose normalizes it.
  PROJECT=${ASSISTANT_COMPOSE_PROJECT:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$DIR/.env" 2>/dev/null | tail -n 1)}
  [ -n "$PROJECT" ] || PROJECT=$(basename "$DIR" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')
  HOME_DIR=${ASSISTANT_UPDATER_HOME:-$(dirname "$DIR")/$(basename "$DIR")-updater}
  case "$HOME_DIR/" in "$DIR"/*) die "the updater home must be outside the checkout" ;; esac
  MIRROR=$HOME_DIR/mirror.git
  STATE=$HOME_DIR/state
  # The schedule runs `update.sh` without arguments: remember which checkout this home serves.
  [ ! -d "$MIRROR" ] || [ "$(cat "$HOME_DIR/checkout" 2>/dev/null)" = "$DIR" ] || echo "$DIR" > "$HOME_DIR/checkout" 2>/dev/null || true
  LOCK=$HOME_DIR/lock
  LOGS_MP=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_logs" 2>/dev/null || true)
  # Root writes the `logs` volume directly; anyone else through a throwaway container (slower).
  LOGS_DIRECT=0
  [ -n "$LOGS_MP" ] && [ -d "$LOGS_MP" ] && [ -w "$LOGS_MP" ] && LOGS_DIRECT=1
}

# Runs a command as the given uid: directly if that is us, through sudo if we are root.
as_uid() {
  u=$1; shift
  if [ "$(id -u)" = "$u" ]; then "$@"
  elif [ "$(id -u)" = 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "sudo is missing; cannot run git as uid $u"
    sudo -n -H -u "#$u" "$@"
  else die "running as uid $(id -u), need uid $u or root"; fi
}
mirror_git() { as_uid "$(stat -c %u "$MIRROR")" git --git-dir="$MIRROR" "$@"; }

if docker compose version >/dev/null 2>&1; then DC_BIN="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC_BIN="docker-compose"
else DC_BIN=""; fi

# limit <seconds> <cmd...>: runs cmd, killed when it takes longer (a hung build fails instead of hanging).
limit() {
  t=$1; shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 30 "$t" "$@"; else "$@"; fi
}
# The project's compose command. -f is explicit, so a docker-compose.override.yml dropped into the
# checkout is never picked up.
dc() { limit "$STEP_TIMEOUT" $DC_BIN -p "$PROJECT" --project-directory "$DIR" -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" "$@"; }
# Same, but every build context comes from the verified copy of main ($SRC), not the checkout.
dc_src() { $DC_BIN -p "$PROJECT" --project-directory "$SRC" -f "$SRC/docker-compose.yml" --env-file "$DIR/.env" "$@"; }
dc_build() { limit "$BUILD_TIMEOUT" $DC_BIN -p "$PROJECT" --project-directory "$SRC" -f "$SRC/docker-compose.yml" --env-file "$DIR/.env" build "$@"; }
# Services of main's compose file that have a build section (one build step each).
buildable() {
  dc_src config --no-interpolate 2>/dev/null |
    awk '/^services:/ { s = 1; next } /^[^ ]/ { s = 0 } s && /^  [A-Za-z0-9_.-]+:$/ { n = $1; sub(/:$/, "", n) } s && /^    build:/ { print n }' |
    awk '!seen[$0]++'
}

# The image of the agents' container (it has git and sh): the throwaway containers run it. The service was
# called claude before llm (an install updating across the rename still has that one); terminal is built
# from the same Dockerfile.
claude_image() {
  img=""
  for v in llm claude terminal; do
    c=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$v" | head -n 1)
    [ -z "$c" ] || img=$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)
    [ -z "$img" ] || break
  done
  echo "${img:-$PROJECT-llm}"
}

# --- output for the app ----------------------------------------------------------------------------
# logs_put <name> [append]: stdin to a file in the `logs` volume.
logs_put() {
  name=$1 mode=${2:-replace}
  if [ "$LOGS_DIRECT" = 1 ]; then
    if [ "$mode" = append ]; then cat >> "$LOGS_MP/$name"; else cat > "$LOGS_MP/$name.tmp" && mv "$LOGS_MP/$name.tmp" "$LOGS_MP/$name"; fi
    chmod 644 "$LOGS_MP/$name" 2>/dev/null || true
  else
    op='>'; [ "$mode" = append ] && op='>>'
    docker run --rm -i --network none --user 0 -v "${PROJECT}_logs:/logs" --entrypoint sh "$(claude_image)" \
      -c "cat $op /logs/$name && chmod 644 /logs/$name" >/dev/null 2>&1 || true
  fi
}

LOG_BUF=""
log() {
  line="$(iso) $*"
  [ "$TTY" = 1 ] && printf '\r\033[K'
  printf '[update] %s\n' "$*"
  LOG_BUF="$LOG_BUF$line
"
}
flush_log() { [ -z "$LOG_BUF" ] || { printf '%s' "$LOG_BUF" | logs_put updater.log append; LOG_BUF=""; }; }

# A sign of life: every run, and every few seconds while an update runs (the app tells a running update
# from one whose process died by it). Without direct access at most every few minutes (a container each).
heartbeat() {
  if [ "$LOGS_DIRECT" = 1 ]; then iso > "$LOGS_MP/updater-heartbeat" && chmod 644 "$LOGS_MP/updater-heartbeat" 2>/dev/null
  elif [ -z "$(find "$HOME_DIR/heartbeat" -mmin -"${1:-10}" 2>/dev/null)" ]; then
    iso | logs_put updater-heartbeat && touch "$HOME_DIR/heartbeat"
  fi
  return 0
}

json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# status <ok|failed|blocked|updating|available> <message>: <home>/status.json and the app's copy.
STEP_NO=0 STEP_TOTAL=0 STARTED_AT="" ACTIONS="" SHA="" DEPLOYED="" DEPLOYED_AT="" ATTEMPT=0
write_status() {
  {
    printf '{"status":%s,"message":%s,"actions":%s,' "$(json_str "$1")" "$(json_str "$2")" "$(json_str "$ACTIONS")"
    printf '"sha":%s,"deployedSha":%s,"deployedAt":%s,' "$(json_str "$SHA")" "$(json_str "$DEPLOYED")" "$(json_str "$DEPLOYED_AT")"
    printf '"at":%s,"step":%s,"steps":%s,"startedAt":%s,' "$(json_str "$(iso)")" "$STEP_NO" "$STEP_TOTAL" "$(json_str "$STARTED_AT")"
    printf '"attempt":%s,"request":%s,"pid":%s,"branch":%s,' "$ATTEMPT" "$(json_str "${HANDLED:-}")" "$$" "$(json_str "$BRANCH")"
    printf '"pendingRestart":%s,"restartRequest":%s,' "$(json_str "$(pending_services)")" "$(json_str "${S_restarted:-}")"
    # The repo (without credentials): the app asks GitHub for main's commit when the page opens.
    printf '"repo":%s}\n' "$(json_str "$(sed -n 's/^[[:space:]]*url = //p' "$MIRROR/config" 2>/dev/null | head -n 1 | sed 's#//[^@/]*@#//#')")"
  } > "$HOME_DIR/status.json.tmp" && mv "$HOME_DIR/status.json.tmp" "$HOME_DIR/status.json"
  logs_put updater-status.json < "$HOME_DIR/status.json"
}

# --- state: what is deployed, what failed, and the journal of the update in progress ---------------
STATE_KEYS="deployed deployed_at failed fail_count failed_at note handled cancelled target base done attempt last_fetch pending restarted"
state_load() {
  for k in $STATE_KEYS; do
    v=$(sed -n "s/^$k=//p" "$STATE" 2>/dev/null | head -n 1)
    eval "$(printf 'S_%s=%s' "$k" "\"\$v\"")"
  done
  DEPLOYED=$S_deployed DEPLOYED_AT=$S_deployed_at HANDLED=$S_handled
  : "${S_fail_count:=0}" "${S_attempt:=0}" "${S_last_fetch:=0}"
}
state_save() {
  S_deployed=$DEPLOYED S_deployed_at=$DEPLOYED_AT S_handled=${HANDLED:-}
  for k in $STATE_KEYS; do eval "printf '%s=%s\n' $k \"\$S_$k\""; done > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

# The app's choice (System settings -> Updates), in the logs volume: `mode=auto|manual`,
# `restarts=ask|auto`, and the clicks: `request=<id>` ("Update now", "Resume"), `cancel=<id>` ("Cancel"),
# `restart=<id>` ("Restart now"). Read as data, never run.
read_control() {
  MODE=auto REQUEST="" CANCEL="" RESTARTS="" RESTART_REQ=""
  f=$LOGS_MP/updater-control
  if [ -n "$LOGS_MP" ] && [ -r "$f" ]; then
    MODE=$(sed -n 's/^mode=//p' "$f" | grep -x -e auto -e manual | tail -n 1)
    RESTARTS=$(sed -n 's/^restarts=//p' "$f" | grep -x -e auto -e ask | tail -n 1)
    REQUEST=$(sed -n 's/^request=\([A-Za-z0-9:._-]\{1,64\}\)$/\1/p' "$f" | tail -n 1)
    CANCEL=$(sed -n 's/^cancel=\([A-Za-z0-9:._-]\{1,64\}\)$/\1/p' "$f" | tail -n 1)
    RESTART_REQ=$(sed -n 's/^restart=\([A-Za-z0-9:._-]\{1,64\}\)$/\1/p' "$f" | tail -n 1)
  fi
  [ -n "$MODE" ] || MODE=auto
  [ -n "$RESTARTS" ] || RESTARTS=${ASSISTANT_RESTARTS:-ask}
}

# The held services waiting for a restart (from $S_pending: up:<svc> and restart:<svc>), one line.
pending_services() { for p in ${S_pending:-}; do echo "${p#*:}"; done | awk '!seen[$0]++' | tr '\n' ' ' | sed 's/ $//'; }

# --- the lock --------------------------------------------------------------------------------------
# <home>/lock is a directory (mkdir is atomic) holding the pid, that process's start time and the boot it
# runs in: a lock whose process is gone, or a pid reused by another process after a reboot, is stale.
proc_start() { sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20; }
boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo none; }
lock_holder() {
  [ -d "$LOCK" ] || return 1
  pid=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -z "$pid" ]; then
    # Just created (pid not written yet), or by a process killed in between.
    [ -n "$(find "$LOCK" -maxdepth 0 -mmin +2 2>/dev/null)" ] || { echo starting; return 0; }
    return 1
  fi
  if [ ! -f "$LOCK/boot" ]; then
    # The older updater's lock (pid only): held while that pid lives, for six hours at most.
    [ -d "/proc/$pid" ] && [ -z "$(find "$LOCK" -maxdepth 0 -mmin +360 2>/dev/null)" ] || return 1
    echo "$pid"; return 0
  fi
  [ "$(cat "$LOCK/boot" 2>/dev/null)" = "$(boot_id)" ] || return 1
  [ -d "/proc/$pid" ] || return 1
  [ "$(cat "$LOCK/start" 2>/dev/null)" = "$(proc_start "$pid")" ] || return 1
  echo "$pid"
}
lock_take() {
  if ! mkdir "$LOCK" 2>/dev/null; then
    lock_holder >/dev/null && return 1
    say "taking over the lock of an update that is gone (pid $(cat "$LOCK/pid" 2>/dev/null || echo ?))"
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || return 1
  fi
  echo $$ > "$LOCK/pid.tmp" && proc_start $$ > "$LOCK/start" && boot_id > "$LOCK/boot" && mv "$LOCK/pid.tmp" "$LOCK/pid"
  trap 'on_exit' EXIT
  trap 'exit 130' INT TERM HUP
  return 0
}
SRC="" TICKER=""
on_exit() {
  [ -z "$TICKER" ] || kill "$TICKER" 2>/dev/null
  [ -z "$SRC" ] || rm -rf "$SRC"
  [ "$(cat "$LOCK/pid" 2>/dev/null)" != "$$" ] || rm -rf "$LOCK"
  [ "$TTY" != 1 ] || printf '\033[?25h'
}

# The processes under a pid (children, their children...), from /proc.
descendants() {
  for s in /proc/[0-9]*/stat; do sed -n 's/^\([0-9]*\) .*) [A-Za-z] \([0-9]*\) .*/\2 \1/p' "$s" 2>/dev/null; done |
    awk -v root="$1" '{ kids[$1] = kids[$1] " " $2 } END { n = split(root, q, " "); while (n) { p = q[n--]; m = split(kids[p], k, " "); for (i = 1; i <= m; i++) { print k[i]; q[++n] = k[i] } } }'
}

# --- progress ---------------------------------------------------------------------------------------
TTY=0
bar() { # bar <done> <total> <width>
  awk -v d="$1" -v t="$2" -v w="$3" 'BEGIN { f = t ? int(d * w / t) : 0; s = ""; for (i = 0; i < w; i++) s = s (i < f ? "#" : "."); print s }'
}
# One status line from status.json (also for a terminal following someone else's update).
render() {
  f=$HOME_DIR/status.json
  st=$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' "$f" 2>/dev/null)
  msg=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$f" 2>/dev/null)
  n=$(sed -n 's/.*"step":\([0-9]*\).*/\1/p' "$f" 2>/dev/null); m=$(sed -n 's/.*"steps":\([0-9]*\).*/\1/p' "$f" 2>/dev/null)
  since=$(sed -n 's/.*"startedAt":"\([^"]*\)".*/\1/p' "$f" 2>/dev/null)
  el=""
  if [ -n "$since" ]; then
    s=$(( $(now) - $(date -u -d "$since" +%s 2>/dev/null || now) ))
    el=" $((s / 60))m$((s % 60))s"
  fi
  last=$(tail -c 2000 "$(build_log_path)" 2>/dev/null | tr '\r' '\n' | sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' | grep -v -e '^[[:space:]]*$' -e '^== ' | tail -n 1 | cut -c1-60)
  if [ "$st" = updating ]; then
    m=${m:-0}; n=${n:-0}; done=$((n > 0 ? n - 1 : 0))
    printf '\r\033[K[%s] %s/%s %s%s  %s' "$(bar "$done" "$m" 24)" "$n" "$m" "$msg" "$el" "$last"
  else printf '\r\033[K%s: %s\n' "$st" "$msg"; fi
}
build_log_path() { if [ "$LOGS_DIRECT" = 1 ]; then echo "$LOGS_MP/updater-build.log"; else echo "$HOME_DIR/build.log"; fi; }

# While an update runs: a heartbeat every 15 s (root; a minute otherwise) and, in a terminal, the bar.
start_ticker() {
  parent=$$
  (
    trap 'exit 0' TERM
    i=0
    while kill -0 "$parent" 2>/dev/null; do
      [ $((i % 15)) != 0 ] || heartbeat 1
      [ "$TTY" != 1 ] || render
      sleep 1 & wait $!
      i=$((i + 1))
    done
  ) &
  TICKER=$!
}

# progress <step id>: the next step, for the app's bar, the terminal and the build log.
progress() {
  STEP_NO=$((STEP_NO + 1))
  write_status updating "$(step_name "$1")"
  [ "$TTY" = 1 ] || say "step $STEP_NO/$STEP_TOTAL: $(step_name "$1")"
  printf '\n== %s step %s/%s: %s\n' "$(date -u +%H:%M:%S)" "$STEP_NO" "$STEP_TOTAL" "$(step_name "$1")" >> "$BUILD_LOG" 2>/dev/null || true
}
step_name() {
  case $1 in
    build:all) echo "building every image" ;;
    build:*) echo "building ${1#build:}" ;;
    checkout) echo "updating the code" ;;
    up:all) echo "starting every service" ;;
    up:*) echo "starting $(echo "${1#up:}" | tr , ' ')" ;;
    migrate) echo "migrating the database roles" ;;
    restart:*) echo "restarting ${1#restart:}" ;;
    verify) echo "checking the services" ;;
    remove:*) echo "removing ${1#remove:} (gone from docker-compose.yml)" ;;
    *) echo "$1" ;;
  esac
}

# --- fix-permissions -------------------------------------------------------------------------------
# Files web, claude and terminal (HOST_UID) cannot change break live-reload, git and npm: left by a
# `git pull` or `npm ci` run as root, or by Synology ACLs, which DSM puts on everything under a shared
# folder and which deny writes whatever the owner (`ls` shows r-xr-xr-x+). Root only; cheap when clean.
# The ACL is removed from the checkout directory too, so new files no longer inherit one.
fix_ownership() {
  [ "$(id -u)" = 0 ] && [ "$OWNER_UID" != 0 ] || return 0
  n=$(find "$DIR" -xdev ! -user "$OWNER_UID" ! -path "$DIR/.env" -print -exec chown -h "$OWNER_UID:$OWNER_GID" {} + | grep -c . || true)
  [ "$n" = 0 ] || log "gave $n file(s) in the checkout back to uid $OWNER_UID"
  if command -v synoacltool >/dev/null 2>&1; then
    list=$(mktemp)
    { find "$DIR" -xdev ! -path "$DIR/.env" -exec ls -dln {} +
      [ -n "$LOGS_MP" ] && [ -d "$LOGS_MP" ] && find "$LOGS_MP" -xdev -exec ls -dln {} +
    } 2>/dev/null | acl_paths > "$list"
    n=0
    while IFS= read -r f; do synoacltool -del "$f" >/dev/null 2>&1 && n=$((n + 1)); done < "$list"
    rm -f "$list"
    if [ "$n" != 0 ]; then
      log "removed Synology ACLs from $n path(s)"
      # They leave x bits on every file: without this git counts each one as changed and pulls stop.
      # Only the config file is written (-f, from /): no git command runs as root in the checkout.
      (cd / && git config -f "$DIR/.git/config" core.fileMode false) 2>/dev/null || true
      chown "$OWNER_UID:$OWNER_GID" "$DIR/.git/config" 2>/dev/null || true
    fi
  fi
  # Owner read/write everywhere (and x on directories), else the owner still cannot write. Removing a
  # Synology ACL can leave mode bits of 000 behind. Git keeps its object files read-only on purpose: they
  # only need u+r, their directories (.git/objects/pack, ...) still need u+rwx.
  n=$(find "$DIR" -xdev ! -path "$DIR/.env" ! -path "$DIR/.git/objects/*" ! -type l \
    \( ! -perm -u+rw -o -type d ! -perm -u+x \) -print -exec chmod u+rwX {} + | grep -c . || true)
  m=$(find "$DIR/.git/objects" -xdev \( -type d ! -perm -u+rwx -exec chmod u+rwx {} \; -print \) -o \
    \( -type f ! -perm -u+r -exec chmod u+r {} + -print \) 2>/dev/null | grep -c . || true)
  n=$((n + m))
  [ "$n" = 0 ] || log "made $n path(s) writable by their owner"
  if [ -n "$LOGS_MP" ] && [ -d "$LOGS_MP" ]; then
    chmod 1777 "$LOGS_MP"
    [ ! -e "$LOGS_MP/web.log" ] || { chown "$OWNER_UID" "$LOGS_MP/web.log"; chmod u+rw "$LOGS_MP/web.log"; }
  fi
  return 0
}

# --- the checkout, in a throwaway container ---------------------------------------------------------
# git_checkout <check|merge>: only the checkout and the mirror (read-only) are mounted, no network, hooks
# off. Prints head:<sha> and result:<uptodate|ahead|behind|merged|branch X|diverged|failed X>.
git_checkout() {
  limit "$STEP_TIMEOUT" docker run --rm --network none --user "$OWNER_UID:$OWNER_GID" -e HOME=/tmp \
    -v "$DIR:/repo" -v "$MIRROR:/mirror:ro" -w /repo --entrypoint sh "$(claude_image)" -c '
      set -u
      # safe.directory from the global config: git fetch from a local path ignores the -c one.
      git config --global safe.directory "*"
      g() { git -c core.hooksPath=/dev/null "$@"; }
      cur=$(g symbolic-ref --short -q HEAD) || cur=""
      [ "$cur" = "$2" ] || { echo "result:branch ${cur:-detached}"; exit 0; }
      g fetch -q /mirror "+refs/heads/$2:refs/remotes/origin/$2" >&2 || { echo "result:failed fetch"; exit 0; }
      echo "head:$(g rev-parse HEAD)"
      if [ "$(g rev-parse HEAD)" = "$1" ]; then echo result:uptodate
      elif g merge-base --is-ancestor "$1" HEAD; then echo result:ahead
      elif g merge-base --is-ancestor HEAD "$1"; then
        if [ "$3" = check ]; then
          # Would the fast-forward go through? Local changes (or untracked files) where the update changes
          # files stop it.
          { g diff --name-only HEAD; g ls-files --others --exclude-standard; } > /tmp/local
          clash=""
          [ ! -s /tmp/local ] || clash=$(g diff --name-only HEAD "$1" | grep -Fx -f /tmp/local || true)
          if [ -n "$clash" ]; then echo "result:failed local changes in $(echo "$clash" | head -n 3 | tr "\n" " ")"; else echo result:behind; fi
        elif g merge --ff-only -q "$1" >&2; then echo result:merged; else echo "result:failed merge"; fi
      else echo result:diverged; fi' sh "$SHA" "$BRANCH" "$1" 2> "$HOME_DIR/git.err"
}
blocked_message() {
  case $1 in
    "branch "*) echo "the checkout is on ${1#branch }, not $BRANCH: switch it back to update" ;;
    diverged) echo "local $BRANCH has commits that are not on GitHub: push or drop them to update" ;;
    "failed local changes"*) echo "uncommitted changes would be overwritten (${1#failed local changes in }): commit or drop them" ;;
    "failed merge") echo "cannot fast-forward the checkout: $(tail -n 1 "$HOME_DIR/git.err")" ;;
    *) echo "checkout update failed: ${1:-no result} $(tail -n 1 "$HOME_DIR/git.err" 2>/dev/null)" ;;
  esac
}

# --- steps -------------------------------------------------------------------------------------------
# STEPS: the steps of an update from $1 to $SHA (ACTIONS: the plan, CHANGED_COUNT: files changed).
steps_for() {
  base=$1
  if [ -n "$base" ] && mirror_git cat-file -e "$base^{commit}" 2>/dev/null; then
    changed=$(mirror_git diff --name-only "$base" "$SHA")
  else
    changed=docker-compose.yml # unknown base: everything
  fi
  ACTIONS=$(printf '%s\n' "$changed" | plan | tr '\n' ' ' | sed 's/ $//')
  CHANGED_COUNT=$(printf '%s\n' "$changed" | grep -c . || true)
  known=" $(dc config --services 2>/dev/null | tr '\n' ' ') "
  all=0 builds="" restarts="" migrate=0
  for a in $ACTIONS; do
    # Skip services this compose file does not have (e.g. an older checkout); `all` brings new ones.
    case $a in build:* | restart:*) case $known in *" ${a#*:} "*) ;; *) continue ;; esac ;; esac
    case $a in
      all) all=1 ;;
      build:*) builds="$builds ${a#build:}" ;;
      restart:*) restarts="$restarts ${a#restart:}" ;;
      migrate) migrate=1 ;;
    esac
  done
  if [ "$all" = 1 ]; then
    builds=$(buildable | tr '\n' ' ')
    [ -n "$builds" ] || builds=all
  fi
  STEPS=""
  for b in $builds; do STEPS="$STEPS build:$b"; done
  STEPS="$STEPS checkout"
  if [ "$all" = 1 ]; then STEPS="$STEPS up:all"
  elif [ -n "$builds" ]; then STEPS="$STEPS up:$(echo $builds | tr ' ' ,)"; fi
  [ "$migrate" = 0 ] || STEPS="$STEPS migrate"
  # Containers of a service that neither main's compose file nor an extension's has (renamed, merged,
  # dropped) go, by label. Never `--remove-orphans`: the updater's compose command has main's file only,
  # so that would remove the extensions' services too.
  for v in $(orphan_services); do STEPS="$STEPS remove:$v"; done
  # `up:all` recreates what changed, not what only needs a restart for its code.
  for s in $restarts; do case " $builds " in *" $s "*) ;; *) STEPS="$STEPS restart:$s" ;; esac; done
  [ "$RESTARTS" = auto ] || [ "$RESTART_NOW" = 1 ] || hold_steps
  # Something was started or restarted: check it runs.
  case $STEPS in *" up:"* | *" restart:"* | *" migrate"*) STEPS="$STEPS verify" ;; esac
}

# The services of a compose file (stdin): the keys under `services:`.
compose_services() { awk '/^services:/ { s = 1; next } /^[^ #]/ { s = 0 } s && /^  [A-Za-z0-9_.-]+:/ { n = $1; sub(/:.*/, "", n); print n }'; }
# Services with containers in this project that no compose file of it defines: main's (from the mirror)
# and the extensions' (COMPOSE_FILE in .env, read as data).
orphan_services() {
  has=" $(compose_services < "$SRC/docker-compose.yml" | tr '\n' ' ') "
  for f in $(sed -n 's/^COMPOSE_FILE=//p' "$DIR/.env" 2>/dev/null | tail -n 1 | tr ':' ' '); do
    case $f in /*) ;; *) f=$DIR/$f ;; esac
    [ "$f" != "$DIR/docker-compose.yml" ] || continue # main's, above (the checkout's may be older)
    has="$has$(compose_services < "$f" 2>/dev/null | tr '\n' ' ') "
  done
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.service"}}' 2>/dev/null |
    awk 'NF && !seen[$0]++' | while IFS= read -r v; do case $has in *" $v "*) ;; *) echo "$v" ;; esac; done
}
project_containers() { docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1"; }

# Takes the held services out of STEPS: what they would get (up:<svc> or restart:<svc>) goes to HOLD_NEW,
# for a restart the user confirms.
hold_steps() {
  HOLD_NEW="" out=""
  for st in $STEPS; do
    case $st in
      up:*)
        if [ "$st" = up:all ]; then list=$(dc_src config --services 2>/dev/null | tr '\n' ' ')
        else list=$(echo "${st#up:}" | tr , ' '); fi
        keep=""
        for v in $list; do
          case " $HELD " in *" $v "*) HOLD_NEW="$HOLD_NEW up:$v" ;; *) keep="$keep $v" ;; esac
        done
        if [ "$st" = up:all ] && [ -z "$HOLD_NEW" ]; then out="$out $st"
        elif [ -n "$keep" ]; then out="$out up:$(echo $keep | tr ' ' ,)"; fi ;;
      restart:*) case " $HELD " in *" ${st#restart:} "*) HOLD_NEW="$HOLD_NEW $st" ;; *) out="$out $st" ;; esac ;;
      # A removed service is often replaced by a held one (terminal by claude): it goes with their restart.
      remove:*) if [ -n "$HOLD_NEW" ] || [ -n "$S_pending" ]; then HOLD_NEW="$HOLD_NEW $st"; else out="$out $st"; fi ;;
      *) out="$out $st" ;;
    esac
  done
  STEPS=$out
}

# apply_restarts <who>: recreates (up:) or restarts the held services that wait for it, from the deployed
# commit's compose file (checked against the checkout like any `up`), then checks they run.
apply_restarts() {
  ups="" rs="" rms=""
  for p in $S_pending; do case $p in up:*) ups="$ups ${p#up:}" ;; restart:*) rs="$rs ${p#restart:}" ;; remove:*) rms="$rms $p" ;; esac; done
  STEPS=""
  [ -z "$ups" ] || STEPS="up:$(echo $ups | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ',' | sed 's/,$//')"
  for v in $rs; do case " $ups " in *" $v "*) ;; *) STEPS="$STEPS restart:$v" ;; esac; done
  STEPS="$STEPS $rms verify" TOUCHED=$(pending_services)
  SHA=$DEPLOYED ACTIONS=$S_pending STEP_TOTAL=$(set -- $STEPS; echo $#) STEP_NO=0 STARTED_AT=$(iso) ATTEMPT=1
  BUILD_LOG=$(build_log_path)
  printf '%s restart of %s (%s)\n' "$(iso)" "$TOUCHED" "$1" > "$BUILD_LOG" 2>/dev/null || BUILD_LOG=/dev/null
  log "restarting $TOUCHED ($1)"
  export_src || { FAIL_MSG="cannot export docker/ from $(short "$SHA")"; return 1; }
  start_ticker
  for st in $STEPS; do
    progress "$st"
    FAIL_MSG=""
    run_step "$st" < /dev/null || { [ -n "$FAIL_MSG" ] || FAIL_MSG="$(step_name "$st") failed"; return 1; }
  done
  S_pending=""
  return 0
}

# restart_now <who>: apply_restarts with its status, log and state.
restart_now() {
  if apply_restarts "$1"; then
    log "restarted $TOUCHED"; write_status ok "restarted $TOUCHED at $(short "$DEPLOYED")"
  else
    log "restart of $TOUCHED FAILED: $FAIL_MSG"; write_status failed "$FAIL_MSG"
  fi
  state_save; flush_log
  [ -z "$TICKER" ] || { kill "$TICKER" 2>/dev/null; wait "$TICKER" 2>/dev/null; TICKER=""; }
  [ "$TTY" != 1 ] || printf '\r\033[K'
}

# docker/ and docker-compose.yml of $SHA, from the mirror: the only build contexts and compose file used.
export_src() {
  [ -z "$SRC" ] || [ ! -f "$SRC/.sha" ] || [ "$(cat "$SRC/.sha")" != "$SHA" ] || return 0
  [ -z "$SRC" ] || rm -rf "$SRC"
  SRC=$(mktemp -d "$HOME_DIR/src.XXXXXX")
  mirror_git archive "$SHA" docker-compose.yml docker | tar -x -C "$SRC" && echo "$SHA" > "$SRC/.sha"
}

run_step() {
  case $1 in
    build:all) export_src && dc_build >> "$BUILD_LOG" 2>&1 ;;
    build:*) export_src && dc_build "${1#build:}" >> "$BUILD_LOG" 2>&1 ;;
    checkout)
      fix_ownership
      out=$(git_checkout merge)
      r=$(printf '%s\n' "$out" | sed -n 's/^result://p')
      case $r in merged | uptodate | ahead) return 0 ;; esac
      FAIL_MSG=$(blocked_message "$r"); return 1 ;;
    up:*)
      export_src || return 1
      # The compose file the services start from is the checkout's: it must be main's, byte for byte.
      if ! cmp -s "$SRC/docker-compose.yml" "$DIR/docker-compose.yml"; then
        FAIL_MSG="docker-compose.yml in the checkout differs from main; refusing to apply it"; return 1
      fi
      if [ "$1" = up:all ]; then dc up -d --no-build >> "$BUILD_LOG" 2>&1
      else
        # shellcheck disable=SC2046
        dc up -d --no-build --no-deps $(echo "${1#up:}" | tr , ' ') >> "$BUILD_LOG" 2>&1
      fi ;;
    migrate) dc up --no-build --no-deps --exit-code-from migrate migrate >> "$BUILD_LOG" 2>&1 ;;
    restart:*) dc restart "${1#restart:}" >> "$BUILD_LOG" 2>&1 ;;
    remove:*) for c in $(project_containers "${1#remove:}"); do docker rm -f "$c" >> "$BUILD_LOG" 2>&1 || return 1; done ;;
    verify) verify_services ;;
  esac
}

# The containers of the services this update touched run (and do not crash-loop) 15 s later.
verify_services() {
  sleep "${ASSISTANT_VERIFY_WAIT:-15}"
  bad=""
  for c in $(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"); do
    set -- $(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}' "$c" 2>/dev/null)
    [ $# = 4 ] || continue
    case " $TOUCHED " in *" $1 "* | " all ") ;; *) continue ;; esac
    case $2 in
      running) [ "$4" -lt 3 ] || bad="$bad $1(restarting)" ;;
      restarting) bad="$bad $1(restarting)" ;;
      exited) [ "$3" = 0 ] || bad="$bad $1(exit $3)" ;;
    esac
  done
  [ -z "$bad" ] && return 0
  FAIL_MSG="not running after the update:$bad (docker logs show why)"
  return 1
}

# deploy: runs the steps of the journal ($S_target from $S_base), skipping those done before.
deploy() {
  export_src || { FAIL_MSG="cannot export docker/ from main"; return 1; }
  steps_for "$S_base"
  STEP_TOTAL=$(set -- $STEPS; echo $#)
  TOUCHED=""
  for s in $STEPS; do
    case $s in build:all | up:all) TOUCHED=all ;; build:* | restart:*) TOUCHED="$TOUCHED ${s#*:}" ;; up:*) TOUCHED="$TOUCHED $(echo "${s#up:}" | tr , ' ')" ;; esac
  done
  [ "$TOUCHED" != all ] || TOUCHED=all
  STEP_NO=0
  for s in $STEPS; do
    case " $S_done " in
      *" $s "*) STEP_NO=$((STEP_NO + 1)); continue ;;
    esac
    progress "$s"
    FAIL_MSG=""
    run_step "$s" < /dev/null; rc=$? # a terminal's keystrokes are for the prompt, not for docker
    if [ "$rc" != 0 ]; then
      [ -n "$FAIL_MSG" ] || FAIL_MSG="$(step_name "$s") failed$( [ "$rc" != 124 ] || echo " (no end after its time limit)")"
      return 1
    fi
    S_done="$S_done $s"
    state_save
    flush_log
  done
  return 0
}

# --- run ---------------------------------------------------------------------------------------------
cmd_run() {
  setup_paths "${1:-}"
  [ -n "$DC_BIN" ] || die "Docker Compose is missing"
  [ -d "$MIRROR" ] || die "no mirror at $MIRROR: run 'sudo ./beni.sh update' or 'sh scripts/update.sh install' first"
  heartbeat
  iso > "$HOME_DIR/last-run" 2>/dev/null; rm -f "$HOME_DIR/last-error"
  read_control
  state_load

  # "Cancel" in the app: stop the update that holds the lock (once per click).
  if [ -n "$CANCEL" ] && [ "$CANCEL" != "$S_cancelled" ]; then
    S_cancelled=$CANCEL; state_save
    if lock_holder >/dev/null || [ -n "$S_target" ]; then cancel_update "from the app"; exit 0; fi
  fi

  requested=0 why=""
  if [ "$NOW" = 1 ]; then requested=1 why="asked from the host"; fi
  if [ -n "$REQUEST" ] && [ "$REQUEST" != "$S_handled" ]; then requested=1 why="asked in the app" HANDLED=$REQUEST; fi

  if ! lock_take; then
    # Someone else's update runs. In a terminal, follow it; it handles the app's request too.
    [ "$NOW" = 1 ] || exit 0
    say "an update is running (pid $(lock_holder)); following it (Ctrl-C stops following, not the update)"
    follow
    lock_take || die "the lock is still taken"
    state_load
    [ -z "$why" ] || HANDLED=${REQUEST:-$S_handled}
  fi

  # "Restart now" in the app, `beni.sh update --restart`, or restarts set to automatic: the held
  # services that wait get their restart (before any update, which may hold more).
  if [ -n "$RESTART_REQ" ] && [ "$RESTART_REQ" != "$S_restarted" ]; then
    S_restarted=$RESTART_REQ; restart_why="asked in the app"
  elif [ "$RESTART_NOW" = 1 ]; then restart_why="asked from the host"
  elif [ "$RESTARTS" = auto ] && [ -n "$S_pending" ]; then restart_why="restarts are automatic"
  else restart_why=""; fi
  if [ -n "$restart_why" ]; then
    if [ -n "$S_pending" ]; then restart_now "$restart_why"
    else state_save; write_status ok "nothing waits for a restart"; fi
  fi

  # A journal without a live lock: the update before this one died (reboot, killed, crash).
  resumed=0
  if [ -n "$S_target" ]; then
    resumed=1
    S_attempt=$((S_attempt + 1))
  fi

  # GitHub: when asked, when resuming, else every FETCH_EVERY seconds.
  if [ "$requested" = 1 ] || [ "$resumed" = 1 ] || [ $(( $(now) - S_last_fetch )) -ge "$FETCH_EVERY" ]; then
    if mirror_git fetch -q --prune origin 2> "$HOME_DIR/fetch.err"; then
      S_last_fetch=$(now)
      [ "$S_note" != fetch ] || { S_note=""; log "GitHub is reachable again"; }
      state_save
    else
      msg="cannot reach GitHub: $(tail -n 1 "$HOME_DIR/fetch.err")"
      if [ "$requested" = 1 ] || [ "$S_note" != fetch ]; then
        S_note=fetch; log "$msg"; SHA=$(mirror_git rev-parse -q --verify "refs/heads/$BRANCH^{commit}" 2>/dev/null || true)
        [ "$resumed" = 1 ] || { write_status failed "$msg"; state_save; flush_log; exit 1; }
      fi
      [ "$resumed" = 1 ] || { state_save; exit 0; }
    fi
  fi
  SHA=$(mirror_git rev-parse -q --verify "refs/heads/$BRANCH^{commit}") || die "no branch $BRANCH in the mirror"

  # The newest updater from main runs the update: replace this copy and run again.
  if self_update && [ "${ASSISTANT_REEXEC:-0}" != 1 ]; then
    state_save; flush_log
    rm -rf "$LOCK"; trap - EXIT
    ASSISTANT_REEXEC=1 exec sh "$HOME_DIR/update.sh" run "$DIR" $( [ "$NOW" = 1 ] && echo --now )
  fi

  if [ "$resumed" = 1 ] && [ "$S_target" != "$SHA" ]; then
    log "main moved to $(short "$SHA") during the interrupted update to $(short "$S_target"): updating to $(short "$SHA")"
    S_target="" S_done="" S_attempt=0 resumed=0
  fi

  if [ "$resumed" = 0 ]; then
    if [ "$SHA" = "$DEPLOYED" ]; then
      # Said once: asked for, or the end of a failed, blocked or available state.
      if [ "$requested" = 1 ] || { [ -n "$S_note" ] && [ "$S_note" != fetch ]; }; then
        S_note="" S_failed="" S_fail_count=0 ACTIONS=""
        [ "$requested" = 0 ] || log "update $why: already at $(short "$SHA")"
        write_status ok "up to date at $(short "$SHA")"; state_save; flush_log
      fi
      exit 0
    fi
    if [ "$requested" = 0 ]; then
      if [ "$MODE" = manual ]; then
        if [ "$S_note" != "available:$SHA" ]; then
          n=$(mirror_git rev-list --count "$DEPLOYED..$SHA" 2>/dev/null || echo "")
          S_note="available:$SHA"
          write_status available "update available: $(short "$SHA")${n:+ ($n new commit$( [ "$n" = 1 ] || echo s))}"
          state_save
        fi
        exit 0
      fi
      # A commit that failed: tried again after 30 minutes, then 2 hours, then only when main moves or asked.
      if [ "$SHA" = "$S_failed" ]; then
        [ "$S_fail_count" -lt "$MAX_ATTEMPTS" ] || exit 0
        wait_s=$(( S_fail_count >= 2 ? 7200 : 1800 ))
        [ $(( $(now) - ${S_failed_at:-0} )) -ge "$wait_s" ] || exit 0
        why="retry $((S_fail_count + 1)) of $MAX_ATTEMPTS"
      fi
    fi
    [ "$SHA" = "$S_failed" ] || S_fail_count=0
    [ "$requested" = 0 ] || S_fail_count=0

    # Before any build: can the checkout take main at all?
    out=$(git_checkout check < /dev/null)
    r=$(printf '%s\n' "$out" | sed -n 's/^result://p')
    head=$(printf '%s\n' "$out" | sed -n 's/^head://p')
    case $r in
      behind | uptodate | ahead) ;;
      *)
        msg=$(blocked_message "$r")
        if [ "$requested" = 1 ] || [ "$S_note" != "blocked:$SHA" ]; then
          S_note="blocked:$SHA"; ACTIONS=""; log "paused at $(short "$SHA"): $msg"
          write_status blocked "$msg"; state_save; flush_log
        fi
        exit 1 ;;
    esac
    S_target=$SHA S_base=${DEPLOYED:-$head} S_done="" S_attempt=1
  elif [ "$S_attempt" -gt "$MAX_ATTEMPTS" ]; then
    S_failed=$SHA S_failed_at=$(now) S_fail_count=$MAX_ATTEMPTS S_note=failed
    log "the update to $(short "$SHA") was interrupted $MAX_ATTEMPTS times; giving up until main moves or it is asked for"
    S_target="" S_done="" S_attempt=0
    write_status failed "interrupted $MAX_ATTEMPTS times; Update now tries again"; state_save; flush_log
    exit 1
  else
    why="resuming after an interruption (attempt $S_attempt of $MAX_ATTEMPTS)"
  fi

  ATTEMPT=$S_attempt
  STARTED_AT=$(iso)
  S_note=""
  state_save
  BUILD_LOG=$(build_log_path)
  if [ "$resumed" = 1 ]; then printf '\n%s resuming the update to %s\n' "$(iso)" "$(short "$SHA")" >> "$BUILD_LOG" 2>/dev/null || BUILD_LOG=/dev/null
  else printf '%s update to %s\n' "$(iso)" "$(short "$SHA")" > "$BUILD_LOG" 2>/dev/null || BUILD_LOG=/dev/null; fi
  write_status updating "preparing the update to $(short "$SHA")"
  log "updating to $(short "$SHA") from $(short "$S_base")${why:+ ($why)}"
  flush_log
  [ "$TTY" != 1 ] || printf '\033[?25l'
  start_ticker

  HOLD_NEW=""
  if deploy; then
    DEPLOYED=$SHA DEPLOYED_AT=$(iso)
    S_failed="" S_fail_count=0 S_note="" S_target="" S_done="" S_attempt=0 STEP_NO=$STEP_TOTAL
    S_pending=$(echo $S_pending $HOLD_NEW | tr ' ' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//')
    held=""; [ -z "$S_pending" ] || held="; $(pending_services) wait for a restart"
    log "updated to $(short "$SHA") (${CHANGED_COUNT:-0} file(s) changed; ${ACTIONS:-no container touched})$held"
    write_status ok "updated to $(short "$SHA")$held"
    rc=0
  else
    S_failed=$SHA S_failed_at=$(now) S_fail_count=$((S_fail_count + 1)) S_note=failed
    S_target="" S_done="" S_attempt=0
    log "update to $(short "$SHA") FAILED: $FAIL_MSG; the containers that ran before keep running where they were not replaced"
    write_status failed "$FAIL_MSG"
    rc=1
  fi
  state_save
  flush_log
  [ -z "$TICKER" ] || { kill "$TICKER" 2>/dev/null; wait "$TICKER" 2>/dev/null; TICKER=""; }
  [ "$TTY" != 1 ] || { printf '\r\033[K'; [ "$rc" = 0 ] && say "done: $(short "$SHA") runs" || say "failed: $FAIL_MSG (log: $BUILD_LOG)"; }
  [ "$rc" = 0 ] && [ -n "$S_pending" ] && ask_restart
  exit $rc
}

# In a terminal: offer the restart of the held services right away.
ask_restart() {
  [ "$TTY" = 1 ] && [ -r /dev/tty ] || { say "$(pending_services) wait for a restart: System settings > Updates, or sudo ./beni.sh update --restart"; return 0; }
  printf '[update] %s run the previous version. Restart now? It ends the Claude and Codex sessions and the terminal in them. [y/N] ' "$(pending_services)"
  # No answer in 10 minutes counts as no (someone walked away from the terminal).
  # (--foreground: a command in the background process group cannot read the terminal.)
  if timeout --foreground 1 true 2>/dev/null; then
    a=$(timeout --foreground "${ASSISTANT_PROMPT_TIMEOUT:-600}" sh -c 'read -r a < /dev/tty && echo "$a"' || true)
  else read -r a < /dev/tty || a=""; fi
  echo
  case $a in
    [yY]*) restart_now "asked from the host"; [ -n "$S_pending" ] || say "restarted" ;;
    *) say "left for later: System settings > Updates, or sudo ./beni.sh update --restart" ;;
  esac
}

# follow: shows someone else's update until its lock is free.
follow() {
  while lock_holder >/dev/null; do
    [ "$TTY" = 1 ] && render || true
    sleep 2
  done
  [ "$TTY" != 1 ] || printf '\r\033[K'
  sed -n 's/.*"status":"\([^"]*\)".*"message":"\([^"]*\)".*/[update] that update ended: \1: \2/p' "$HOME_DIR/status.json" 2>/dev/null
}

# Replaces <home>/update.sh with main's scripts/update.sh when that changed. 0 = replaced.
self_update() {
  self=$HOME_DIR/update.sh
  [ -f "$self" ] || return 1
  if mirror_git show "$SHA:scripts/update.sh" > "$self.new" 2>/dev/null && [ -s "$self.new" ] &&
     sh -n "$self.new" && ! cmp -s "$self.new" "$self"; then
    chmod 755 "$self.new" && mv "$self.new" "$self" && log "the updater updated itself from $(short "$SHA")" && return 0
  fi
  rm -f "$self.new"
  return 1
}

# cancel_update <who>: stop the running update (its shell and everything under it, e.g. `docker compose
# build`; BuildKit drops a build whose client is gone), free the lock and mark main's commit failed, so
# it is not retried by itself. The containers that ran before keep running.
cancel_update() {
  pid=$(lock_holder || true)
  case $pid in '' | starting) pids="" ;; *) pids="$pid $(descendants "$pid")" ;; esac
  for sig in TERM KILL; do
    for p in $pids; do kill "-$sig" "$p" 2>/dev/null; done
    [ "$sig" = KILL ] || [ -z "$pids" ] || sleep 3
  done
  rm -rf "$LOCK"
  state_load
  SHA=${S_target:-$(mirror_git rev-parse -q --verify "refs/heads/$BRANCH^{commit}" 2>/dev/null || true)}
  S_failed=$SHA S_failed_at=$(now) S_fail_count=$MAX_ATTEMPTS S_note=failed S_target="" S_done="" S_attempt=0
  log "update cancelled $1; the containers that ran before keep running"
  write_status failed "cancelled $1; Update now tries again"
  state_save
  flush_log
}

cmd_status() {
  setup_paths "${1:-}"
  if [ "$JSON" = 1 ]; then cat "$HOME_DIR/status.json" 2>/dev/null || echo '{}'; return 0; fi
  [ -f "$HOME_DIR/status.json" ] || { say "no update has run yet ($HOME_DIR)"; return 0; }
  state_load
  if pid=$(lock_holder); then
    say "running (pid $pid)"; TTY=0; render; echo
  else
    sed -n 's/.*"status":"\([^"]*\)".*"message":"\([^"]*\)".*"at":"\([^"]*\)".*/[update] \1: \2 (\3)/p' "$HOME_DIR/status.json"
    [ -z "$S_target" ] || say "an update to $(short "$S_target") was interrupted (step(s) done:${S_done:- none}); the next run resumes it"
  fi
  say "running commit: $(short "$DEPLOYED") since ${DEPLOYED_AT:-?}"
  [ -z "$S_pending" ] || say "waiting for a restart: $(pending_services) (sudo ./beni.sh update --restart)"
  say "last run: $(cat "$HOME_DIR/last-run" 2>/dev/null || echo never) (the schedule should run it every minute)"
  [ ! -f "$HOME_DIR/last-error" ] || say "last error: $(cat "$HOME_DIR/last-error")"
  [ -z "$LOGS_MP" ] || [ ! -r "$LOGS_MP/updater-control" ] || say "mode: $(sed -n 's/^mode=//p' "$LOGS_MP/updater-control" | tail -n 1)"
}

# --- install: once, as root on the NAS (or as the checkout owner on a Linux box in the docker group)
cmd_install() {
  setup_paths "${1:-}"
  url=${ASSISTANT_REPO:-$(git config -f "$DIR/.git/config" remote.origin.url 2>/dev/null || true)}
  [ -n "$url" ] || die "set ASSISTANT_REPO to the repo URL"
  say "checkout:     $DIR (owner uid $OWNER_UID)"
  say "updater home: $HOME_DIR (not visible to any container)"
  say "repo:         $(printf '%s' "$url" | sed 's#//[^@/]*@#//***@#')"
  mkdir -p "$HOME_DIR" && chmod 755 "$HOME_DIR"
  # A Synology shared folder puts an ACL on the new folder that denies the owner writes: the mirror
  # would then be cloned as root, and the checkout owner could not fetch from it.
  if command -v synoacltool >/dev/null 2>&1; then
    find "$HOME_DIR" -xdev -exec ls -dln {} + 2>/dev/null | acl_paths | while IFS= read -r f; do synoacltool -del "$f" >/dev/null 2>&1; done
  fi
  fix_ownership
  # A mirror an older version cloned as root goes to the checkout owner (it fetches with their credentials).
  if [ -d "$MIRROR" ] && [ "$(id -u)" = 0 ] && [ "$OWNER_UID" != 0 ] && [ "$(stat -c %u "$MIRROR")" = 0 ]; then
    chown -R "$OWNER_UID:$OWNER_GID" "$MIRROR" && chmod -R u+rwX "$MIRROR" && say "mirror given to uid $OWNER_UID"
  fi
  # A mirror of another repo (an earlier install in this folder, before the repo moved): clone the right
  # one; the deployed commit is then unknown to it, so the first update rebuilds everything.
  repo_changed=0
  if [ -d "$MIRROR" ] && [ "$(git --git-dir="$MIRROR" config remote.origin.url 2>/dev/null)" != "$url" ]; then
    say "the mirror tracks $(git --git-dir="$MIRROR" config remote.origin.url 2>/dev/null | sed 's#//[^@/]*@#//***@#'): replacing it"
    rm -rf "$MIRROR"
    repo_changed=1
  fi
  if [ ! -d "$MIRROR" ]; then
    # Clone as the checkout owner (their git credentials), else as root.
    mkdir "$MIRROR"
    [ "$(id -u)" = 0 ] && chown "$OWNER_UID:$OWNER_GID" "$MIRROR"
    if as_uid "$OWNER_UID" git clone -q --mirror "$url" "$MIRROR" 2>/dev/null; then :
    elif [ "$(id -u)" = 0 ] && chown 0:0 "$MIRROR" && git clone -q --mirror "$url" "$MIRROR"; then :
    else rm -rf "$MIRROR"; die "cannot clone $url: check the git credentials of uid $OWNER_UID"; fi
    say "mirror cloned"
  fi

  cp "$0" "$HOME_DIR/update.sh.new" && chmod 755 "$HOME_DIR/update.sh.new" && mv "$HOME_DIR/update.sh.new" "$HOME_DIR/update.sh"
  echo "$DIR" > "$HOME_DIR/checkout"
  # An older updater's copy: its scheduled task keeps working (auto-update.sh hands over to update.sh).
  [ ! -f "$HOME_DIR/auto-update.sh" ] || cp "$(dirname "$0")/auto-update.sh" "$HOME_DIR/auto-update.sh" 2>/dev/null || true

  # The running checkout counts as deployed, so the first run does not rebuild everything.
  if [ ! -f "$STATE" ]; then
    # Read as plain files: no git command runs as root on the checkout Claude edits.
    ref=$(sed -n 's/^ref: //p' "$DIR/.git/HEAD")
    head=$(cat "$DIR/.git/$ref" 2>/dev/null || sed -n "s# $ref\$##p" "$DIR/.git/packed-refs" 2>/dev/null | head -n 1)
    state_load
    DEPLOYED=$head DEPLOYED_AT=$(iso) SHA=$head
    state_save
    write_status ok "installed; watching $BRANCH"
  elif [ "$repo_changed" = 1 ]; then
    state_load
    S_failed="" S_note="" S_target="" S_done=""
    state_save
    write_status ok "installed for $(printf '%s' "$url" | sed 's#//[^@/]*@#//***@#'); the next update rebuilds everything"
  fi
  # Manual mode on request (install.sh when auto-update was declined), unless the app already chose.
  if [ "$MANUAL" = 1 ] && { [ -z "$LOGS_MP" ] || [ ! -f "$LOGS_MP/updater-control" ]; }; then
    echo mode=manual | logs_put updater-control
    say "updates are manual: the app shows new versions and updates when asked"
  fi

  cmd="sh $HOME_DIR/update.sh"
  if [ -f /etc/synoinfo.conf ]; then
    cat <<SYNO

  Synology: add the schedule once in DSM (or change the command of the existing task):
    Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script
      General:   Task "assistant update", User: root
      Schedule:  Daily, Frequency: every minute (first run 00:00, last run 23:59)
      Task Settings > Run command:
        $cmd

SYNO
  elif command -v crontab >/dev/null 2>&1; then
    line="* * * * * $cmd >/dev/null 2>&1"
    cur=$(crontab -l 2>/dev/null || true)
    if printf '%s\n' "$cur" | grep -qxF "$line"; then say "cron entry exists"
    else
      { printf '%s\n' "$cur" | grep -v -e "$HOME_DIR/auto-update.sh" -e "$HOME_DIR/update.sh" | grep -v '^$'; echo "$line"; } | crontab - &&
        say "cron: $line"
    fi
  else
    say "no crontab: run every minute: $cmd"
  fi
}

# --- arguments: [command] [--now] [--json] [--manual] [checkout] -------------------------------------
CMD="" NOW=0 JSON=0 MANUAL=0 RESTART_NOW=0 ARG=""
for a in "$@"; do
  case $a in
    --now) NOW=1 ;;
    --json) JSON=1 ;;
    --manual) MANUAL=1 ;;
    --restart) RESTART_NOW=1 NOW=1 ;;
    run | status | cancel | install | fix-permissions | plan | acl-paths) [ -n "$CMD" ] || CMD=$a ;;
    -h | --help | help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $a" ;;
    *) ARG=$a ;;
  esac
done
# In a terminal, a plain run is someone asking for an update: now, with a progress bar.
if [ -z "$CMD" ] && [ -t 0 ] && [ -t 1 ]; then NOW=1; fi
[ "$NOW" != 1 ] || { [ ! -t 1 ] || TTY=1; }
case ${CMD:-run} in
  plan) plan ;;
  acl-paths) acl_paths ;;
  fix-permissions) setup_paths "$ARG"; fix_ownership; flush_log ;;
  run) cmd_run "$ARG" ;;
  install) cmd_install "$ARG" ;;
  status) cmd_status "$ARG" ;;
  cancel)
    setup_paths "$ARG"
    if lock_holder >/dev/null || [ -n "$(sed -n 's/^target=//p' "$STATE" 2>/dev/null)" ]; then cancel_update "from the host"
    else say "no update is running"; fi ;;
esac
