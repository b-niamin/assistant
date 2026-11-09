#!/bin/sh
# Auto-update: deploys new commits on GitHub main to this machine (spec 006).
#
#   sudo sh scripts/auto-update.sh install [checkout]   # once: mirror, root-owned copy, schedule
#   sh <updater-home>/auto-update.sh run <checkout>     # every 5 minutes (Task Scheduler / cron)
#   sh scripts/auto-update.sh status [checkout]         # last result
#   sudo sh scripts/auto-update.sh fix-permissions      # owner, Synology ACLs, u+rw in the checkout
#   sh scripts/auto-update.sh plan < changed-paths      # which services a change touches (for tests)
#
# It runs on the HOST, never in a container: no container gets the Docker socket (spec 004). What it
# runs comes only from a private mirror of GitHub main kept OUTSIDE the checkout, which no container
# can see. The checkout itself (that Claude edits) is only touched inside a throwaway container
# (`--network none`, only the checkout mounted), so a hook or a git config written into it cannot run
# on the host. Images are built from the mirror's copy of docker/ and docker-compose.yml, not from the
# checkout.
#
# A tick: fetch main into the mirror; if it moved, fast-forward the checkout (apps/web goes live by
# itself from there), then rebuild or restart only the services whose files
# changed. A failed build leaves the old containers running and is not retried until main moves again.
# Log: /logs/updater.log, status: /logs/updater-status.json (the `logs` volume; System settings shows it).
set -u
PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH:-}
umask 022

BRANCH=${ASSISTANT_BRANCH:-main}

say() { printf '[auto-update] %s\n' "$*"; }
die() { printf '[auto-update] %s\n' "$*" >&2; exit 1; }

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
      docker/claude/*) echo build:claude; echo build:terminal ;;
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

# --- helpers ---------------------------------------------------------------------------------------
resolve_dir() {
  d=${1:-}
  [ -n "$d" ] || d=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)
  [ -f "$d/docker-compose.yml" ] && [ -d "$d/.git" ] || die "not an assistant checkout: $d"
  (cd "$d" && pwd -P)
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

# The project's compose command. -f is explicit, so a docker-compose.override.yml dropped into the
# checkout is never picked up.
dc() { $DC_BIN -p "$PROJECT" --project-directory "$DIR" -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" "$@"; }
# Same, but every build context comes from the verified copy of main ($SRC), not the checkout.
dc_build() { $DC_BIN -p "$PROJECT" --project-directory "$SRC" -f "$SRC/docker-compose.yml" --env-file "$DIR/.env" build "$@"; }

claude_image() {
  c=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=claude | head -n 1)
  img=""
  [ -n "$c" ] && img=$(docker inspect -f '{{.Config.Image}}' "$c" 2>/dev/null)
  echo "${img:-$PROJECT-claude}"
}

# Writes stdin to a file in the `logs` volume (append with $2 = append). Root writes the volume
# directory directly; anyone else goes through a throwaway container.
logs_put() {
  name=$1 mode=${2:-replace}
  mp=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_logs" 2>/dev/null || true)
  if [ -n "$mp" ] && [ -d "$mp" ] && [ -w "$mp" ]; then
    if [ "$mode" = append ]; then cat >> "$mp/$name"; else cat > "$mp/$name.tmp" && mv "$mp/$name.tmp" "$mp/$name"; fi
    chmod 644 "$mp/$name" 2>/dev/null || true
  else
    op='>'; [ "$mode" = append ] && op='>>'
    docker run --rm -i --network none --user 0 -v "${PROJECT}_logs:/logs" --entrypoint sh "$(claude_image)" \
      -c "cat $op /logs/$name && chmod 644 /logs/$name" >/dev/null 2>&1 || true
  fi
}

LOG_BUF=""
log() {
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  printf '[auto-update] %s\n' "$line"
  LOG_BUF="$LOG_BUF$line
"
}
flush_log() { [ -n "$LOG_BUF" ] && printf '%s' "$LOG_BUF" | logs_put updater.log append; LOG_BUF=""; }

json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# status <ok|failed|blocked> <message> <actions>
write_status() {
  {
    printf '{"status":%s,' "$(json_str "$1")"
    printf '"message":%s,' "$(json_str "$2")"
    printf '"actions":%s,' "$(json_str "$3")"
    printf '"sha":%s,' "$(json_str "$SHA")"
    printf '"deployedSha":%s,' "$(json_str "$DEPLOYED")"
    printf '"deployedAt":%s,' "$(json_str "$DEPLOYED_AT")"
    printf '"at":%s,' "$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '"branch":%s}\n' "$(json_str "$BRANCH")"
  } | logs_put updater-status.json
}

state_get() { sed -n "s/^$1=//p" "$STATE" 2>/dev/null | head -n 1; }
state_save() {
  printf 'deployed=%s\ndeployed_at=%s\nfailed=%s\nnote=%s\n' "$DEPLOYED" "$DEPLOYED_AT" "$FAILED" "$NOTE" > "$STATE.tmp" &&
    mv "$STATE.tmp" "$STATE"
}

setup_paths() {
  DIR=$(resolve_dir "${1:-}")
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
}

# `ls -dln` lines (stdin) -> paths that carry an ACL (mode ends in "+"), one per line.
acl_paths() { awk '$1 ~ /\+$/ { for (i = 0; i < 8; i++) sub(/^[^ ]+ +/, ""); print }'; }

# Files web, claude and terminal (HOST_UID) cannot change break live-reload, git and npm: left by a
# `git pull` or `npm ci` run as root, or by Synology ACLs, which DSM puts on everything under a shared
# folder and which deny writes whatever the owner (`ls` shows r-xr-xr-x+). Root only; cheap when clean.
# The ACL is removed from the checkout directory too, so new files no longer inherit one.
fix_ownership() {
  [ "$(id -u)" = 0 ] && [ "$OWNER_UID" != 0 ] || return 0
  n=$(find "$DIR" -xdev ! -user "$OWNER_UID" ! -path "$DIR/.env" -print -exec chown -h "$OWNER_UID:$OWNER_GID" {} + | grep -c . || true)
  [ "$n" = 0 ] || log "gave $n file(s) in the checkout back to uid $OWNER_UID"
  mp=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_logs" 2>/dev/null || true)
  if command -v synoacltool >/dev/null 2>&1; then
    list=$(mktemp)
    { find "$DIR" -xdev ! -path "$DIR/.env" -exec ls -dln {} +
      [ -n "$mp" ] && [ -d "$mp" ] && find "$mp" -xdev -exec ls -dln {} +
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
  if [ -n "$mp" ] && [ -d "$mp" ]; then
    chmod 1777 "$mp"
    [ ! -e "$mp/web.log" ] || { chown "$OWNER_UID" "$mp/web.log"; chmod u+rw "$mp/web.log"; }
  fi
  return 0
}

# --- run: one tick ---------------------------------------------------------------------------------
cmd_run() {
  setup_paths "${1:-}"
  [ -n "$DC_BIN" ] || die "Docker Compose is missing"
  [ -d "$MIRROR" ] || die "no mirror at $MIRROR: run 'sh scripts/auto-update.sh install' first"

  LOCK=$HOME_DIR/lock
  if ! mkdir "$LOCK" 2>/dev/null; then
    # A crashed tick leaves the lock behind: take it over after an hour.
    [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ] || exit 0
    rm -rf "$LOCK"; mkdir "$LOCK" || exit 0
  fi
  SRC=""
  trap 'rm -rf "$LOCK" ${SRC:+"$SRC"}' EXIT INT TERM

  DEPLOYED=$(state_get deployed) DEPLOYED_AT=$(state_get deployed_at) FAILED=$(state_get failed) NOTE=$(state_get note)
  SHA=""

  if ! mirror_git fetch -q --prune origin 2>"$HOME_DIR/fetch.err"; then
    msg="fetch failed: $(tail -n 1 "$HOME_DIR/fetch.err")"
    if [ "$NOTE" != "fetch" ]; then NOTE=fetch; log "$msg"; write_status failed "$msg" ""; state_save; flush_log; fi
    exit 1
  fi
  SHA=$(mirror_git rev-parse -q --verify "refs/heads/$BRANCH^{commit}") || die "no branch $BRANCH in the mirror"

  # Nothing new, or this commit already failed: stay quiet until main moves (FORCE=1 retries).
  if [ "${FORCE:-0}" != 1 ] && { [ "$SHA" = "$DEPLOYED" ] || [ "$SHA" = "$FAILED" ]; }; then
    if [ "$NOTE" = fetch ]; then # GitHub is reachable again
      NOTE=""; [ "$SHA" = "$FAILED" ] && NOTE=failed
      log "fetch works again"; state_save
      [ "$SHA" = "$DEPLOYED" ] && write_status ok "up to date" ""
      flush_log
    fi
    exit 0
  fi

  self_update
  fix_ownership

  # Fast-forward the checkout inside a throwaway container: only the checkout and the mirror
  # (read-only) are mounted, no network, hooks off. Prints head:<sha> and one result word.
  out=$(docker run --rm --network none --user "$OWNER_UID:$OWNER_GID" -e HOME=/tmp \
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
        if g merge --ff-only -q "$1" >&2; then echo result:merged; else echo "result:failed merge"; fi
      else echo result:diverged; fi' sh "$SHA" "$BRANCH" 2>"$HOME_DIR/merge.err")
  head=$(printf '%s\n' "$out" | sed -n 's/^head://p')
  result=$(printf '%s\n' "$out" | sed -n 's/^result://p')

  case $result in
    merged | uptodate | ahead) ;;
    *)
      case $result in
        "branch "*) msg="the checkout is on ${result#branch }, not $BRANCH: switch it back to update" ;;
        diverged) msg="local $BRANCH has commits that are not on GitHub: push or drop them to update" ;;
        "failed merge") msg="cannot fast-forward (uncommitted changes in the way?): $(tail -n 1 "$HOME_DIR/merge.err")" ;;
        *) msg="checkout update failed: ${result:-no result} $(tail -n 1 "$HOME_DIR/merge.err" 2>/dev/null)" ;;
      esac
      if [ "$NOTE" != "blocked:$SHA:$result" ]; then
        NOTE="blocked:$SHA:$result"; log "blocked at ${SHA%"${SHA#???????}"}: $msg"
        write_status blocked "$msg" ""; state_save; flush_log
      fi
      exit 1 ;;
  esac

  # What changed since the last deploy (first run: since the checkout's previous HEAD).
  base=${DEPLOYED:-$head}
  if [ -n "$base" ] && mirror_git cat-file -e "$base^{commit}" 2>/dev/null; then
    changed=$(mirror_git diff --name-only "$base" "$SHA")
  else
    changed=docker-compose.yml # unknown base: treat as a full deploy
  fi
  actions=$(printf '%s\n' "$changed" | plan | tr '\n' ' ' | sed 's/ $//')
  short=${SHA%"${SHA#???????}"}
  log "main at $short (was ${base%"${base#???????}"}): $(printf '%s\n' "$changed" | grep -c .) file(s) changed; actions: ${actions:-none}"

  if deploy "$actions"; then
    DEPLOYED=$SHA DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED="" NOTE=""
    log "deployed $short"
    write_status ok "deployed $short" "$actions"
  else
    FAILED=$SHA NOTE=failed
    log "deploy of $short FAILED ($STEP); the previous containers keep running; fix main or rerun with FORCE=1"
    write_status failed "$STEP failed at $short; the previous containers keep running" "$actions"
  fi
  state_save
  flush_log
}

# Replaces the installed copy with main's scripts/auto-update.sh when it changed (next tick runs it).
self_update() {
  self=$HOME_DIR/auto-update.sh
  [ -f "$self" ] || return 0
  if mirror_git show "$SHA:scripts/auto-update.sh" > "$self.new" 2>/dev/null && [ -s "$self.new" ] &&
     sh -n "$self.new" && ! cmp -s "$self.new" "$self"; then
    chmod 755 "$self.new" && mv "$self.new" "$self" && log "updated the updater itself"
  fi
  rm -f "$self.new"
}

STEP=""
deploy() {
  acts=$1
  builds="" ups="" restarts="" all=0 migrate=0
  known=" $(dc config --services 2>/dev/null | tr '\n' ' ') "
  for a in $acts; do
    # Skip services this compose file does not have (e.g. an older checkout).
    case $a in build:* | restart:*) case $known in *" ${a#*:} "*) ;; *) continue ;; esac ;; esac
    case $a in
      all) all=1 ;;
      build:*) builds="$builds ${a#build:}" ;;
      restart:*) restarts="$restarts ${a#restart:}" ;;
      migrate) migrate=1 ;;
    esac
  done
  [ -n "$acts" ] || return 0

  if [ "$all" = 1 ] || [ -n "$builds" ]; then
    # Build contexts and the compose file come from main in the mirror, never from the checkout.
    SRC=$(mktemp -d "$HOME_DIR/src.XXXXXX")
    STEP="export of docker/ from main"
    mirror_git archive "$SHA" docker-compose.yml docker | tar -x -C "$SRC" || return 1
    STEP="check of docker-compose.yml"
    if ! cmp -s "$SRC/docker-compose.yml" "$DIR/docker-compose.yml"; then
      log "docker-compose.yml in the checkout differs from main; refusing to apply it"
      return 1
    fi
    STEP="build"
    if [ "$all" = 1 ]; then
      dc_build || return 1
      STEP="docker compose up"
      dc up -d --no-build || return 1
      # Every container was just reconciled with the new config; restarts are still needed for the
      # ones whose code changed but whose config did not.
    else
      # shellcheck disable=SC2086
      dc_build $builds || return 1
      STEP="docker compose up"
      # shellcheck disable=SC2086
      dc up -d --no-build --no-deps $builds || return 1
      ups=$builds
    fi
  fi

  if [ "$migrate" = 1 ]; then
    STEP="migrate"
    dc up --no-build --no-deps --exit-code-from migrate migrate >/dev/null || return 1
  fi
  for s in $restarts; do
    case " $ups " in *" $s "*) continue ;; esac
    STEP="restart $s"
    dc restart "$s" || return 1
  done
  STEP=""
  return 0
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

  if [ ! -d "$MIRROR" ]; then
    # Clone as the checkout owner (their git credentials), else as root.
    mkdir "$MIRROR"
    [ "$(id -u)" = 0 ] && chown "$OWNER_UID:$OWNER_GID" "$MIRROR"
    if as_uid "$OWNER_UID" git clone -q --mirror "$url" "$MIRROR" 2>/dev/null; then :
    elif [ "$(id -u)" = 0 ] && chown 0:0 "$MIRROR" && git clone -q --mirror "$url" "$MIRROR"; then :
    else rm -rf "$MIRROR"; die "cannot clone $url: check the git credentials of uid $OWNER_UID"; fi
    say "mirror cloned"
  fi

  cp "$0" "$HOME_DIR/auto-update.sh.new" && chmod 755 "$HOME_DIR/auto-update.sh.new" &&
    mv "$HOME_DIR/auto-update.sh.new" "$HOME_DIR/auto-update.sh"

  # The running checkout counts as deployed, so the first tick does not rebuild everything.
  if [ ! -f "$STATE" ]; then
    # Read as plain files: no git command runs as root on the checkout Claude edits.
    ref=$(sed -n 's/^ref: //p' "$DIR/.git/HEAD")
    head=$(cat "$DIR/.git/$ref" 2>/dev/null || sed -n "s# $ref\$##p" "$DIR/.git/packed-refs" 2>/dev/null | head -n 1)
    DEPLOYED=$head DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED="" NOTE=""
    state_save
    SHA=$head
    write_status ok "installed; watching $BRANCH" ""
  fi

  cmd="sh $HOME_DIR/auto-update.sh run $DIR"
  if [ -f /etc/synoinfo.conf ]; then
    cat <<SYNO

  Synology: add the schedule once in DSM:
    Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script
      General:   Task "assistant auto-update", User: root
      Schedule:  Daily, Frequency: every 5 minutes (first run 00:00, last run 23:55)
      Task Settings > Run command:
        $cmd

SYNO
  elif command -v crontab >/dev/null 2>&1; then
    line="*/5 * * * * $cmd >/dev/null 2>&1"
    if crontab -l 2>/dev/null | grep -qF "$HOME_DIR/auto-update.sh run"; then say "cron entry exists"
    else { crontab -l 2>/dev/null; echo "$line"; } | crontab - && say "added to crontab: $line"; fi
  else
    say "no crontab: run every 5 minutes: $cmd"
  fi
}

cmd_status() {
  setup_paths "${1:-}"
  mp=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJECT}_logs" 2>/dev/null || true)
  [ -n "$mp" ] && [ -r "$mp/updater-status.json" ] && cat "$mp/updater-status.json"
  [ -f "$STATE" ] && cat "$STATE"
  return 0
}

case ${1:-} in
  plan) plan ;;
  acl-paths) acl_paths ;;
  fix-permissions) shift; setup_paths "${1:-}"; fix_ownership; flush_log ;;
  run) shift; cmd_run "$@" ;;
  install) shift; cmd_install "$@" ;;
  status) shift; cmd_status "$@" ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
