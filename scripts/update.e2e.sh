#!/bin/sh
# End-to-end test of scripts/update.sh against a throwaway compose project (needs Docker and root).
#   sudo sh scripts/update.e2e.sh             (E2E_TMP=<dir>: where the test lives; Docker must see the
#                                               same path, e.g. inside a container with the socket mounted)
# It builds a fake "GitHub" repo, a checkout owned by OWNER_UID, a project (`terminal` built from
# docker/terminal, `web` from an image), installs the updater and walks through what happens on a NAS:
# idle runs, changes of each kind, a broken build, a hung build, an update killed halfway (resumed), two
# runs at once, cancelling from the host and from the app, manual mode with "Update now", a terminal run
# with its progress bar, a tampered compose file, a planted hook, local changes in the way, stale locks,
# the updater updating itself, and an older updater's scheduled task handing over.
set -eu
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
OWNER=${OWNER_UID:-1000}
T=$(mktemp -d "${E2E_TMP:-/tmp}/upd-e2e.XXXXXX")
P=upd-e2e-$(printf %s "${T##*.}" | tr A-Z a-z)
CO=$T/$P
UH=$T/$P-updater
fail() { echo "FAIL: $*" >&2; echo "--- last output:" >&2; cat "$T/out" >&2 2>/dev/null; echo "--- build log:" >&2; tail -n 15 "$(build_log)" >&2 2>/dev/null; exit 1; }
build_log() { echo "$LOGS/updater-build.log"; }
ok() { echo "ok - $*"; }
asown() { sudo -n -H -u "#$OWNER" "$@"; }
gito() { asown git -C "$T/work" "$@"; }
cleanup() {
  [ ! -d "$UH/lock" ] || kill -9 $(cat "$UH/lock/pid" 2>/dev/null) 2>/dev/null || true
  docker compose -p "$P" --project-directory "$CO" -f "$CO/docker-compose.yml" --env-file "$CO/.env" down -v --rmi local >/dev/null 2>&1 || true
  rm -rf "$T"
}
[ -n "${E2E_KEEP:-}" ] || trap cleanup EXIT
chown "$OWNER" "$T"

# "GitHub" and a working clone that plays the developer merging PRs.
asown git init -q --bare -b main "$T/origin.git"
asown git clone -q "$T/origin.git" "$T/work" 2>/dev/null
gito config user.email t@example.com; gito config user.name test
asown mkdir -p "$T/work/docker/terminal" "$T/work/apps/web" "$T/work/scripts"
asown sh -c "cat > '$T/work/docker-compose.yml'" <<'YML'
services:
  terminal:
    build: ./docker/terminal
    command: ['sleep', 'infinity']
    volumes: [logs:/logs]
  web:
    image: alpine:3.20
    command: ['sleep', 'infinity']
    volumes: [logs:/logs, ./apps/web:/app]
volumes:
  logs:
YML
asown sh -c "printf 'FROM alpine/git:v2.45.2\nENTRYPOINT []\n' > '$T/work/docker/terminal/Dockerfile'"
asown sh -c "echo v1 > '$T/work/apps/web/page.txt'; printf '.env\n' > '$T/work/.gitignore'"
asown cp "$HERE/update.sh" "$HERE/auto-update.sh" "$T/work/scripts/"
gito add -A; gito commit -qm A; gito push -q origin main 2>/dev/null
commit() { gito add -A; gito commit -qm "$1"; gito push -q origin main 2>/dev/null; }
# The echo makes every test run build afresh (a cached `RUN sleep` would not take its time).
dockerfile() { asown sh -c "printf 'FROM alpine/git:v2.45.2\nENTRYPOINT []\nRUN echo e2e-$P-${T##*.}\n%s\n' '$1' > '$T/work/docker/terminal/Dockerfile'"; }

# The deployed checkout, running.
asown git clone -q "$T/origin.git" "$CO" 2>/dev/null
echo "HOST_UID=$OWNER" > "$CO/.env"; chmod 600 "$CO/.env" # root-owned, like install.sh writes it
dc() { docker compose -p "$P" --project-directory "$CO" -f "$CO/docker-compose.yml" --env-file "$CO/.env" "$@"; }
dc up -d --build --quiet-pull >/dev/null 2>&1
llm_img() { docker inspect -f '{{.Image}}' "$(dc ps -q terminal)"; }
img0=$(llm_img)
LOGS=$(docker volume inspect -f '{{.Mountpoint}}' "${P}_logs")

export ASSISTANT_UPDATER_HOME=$UH ASSISTANT_COMPOSE_PROJECT=$P ASSISTANT_REPO=$T/origin.git
export ASSISTANT_FETCH_EVERY=0 ASSISTANT_VERIFY_WAIT=2
# terminal is restarted at once unless a test sets restarts=ask (the app's default) in the control file.
export ASSISTANT_RESTARTS=auto ASSISTANT_HELD_SERVICES="terminal agent"
sh "$CO/scripts/update.sh" install "$CO" > "$T/out" 2>&1 || fail "install"
# The scheduled run: no terminal, explicit `run` like the cron line's default.
run() { sh "$UH/update.sh" run "$CO" "$@" < /dev/null > "$T/out" 2>&1 && RC=0 || RC=$?; }
bg() { setsid sh "$UH/update.sh" run "$CO" "$@" < /dev/null > "$T/bg.out" 2>&1 & }
st() { sed -n "s/.*\"$1\":\"\\{0,1\\}\\([^\",]*\\).*/\\1/p" "$UH/status.json"; }
state() { sed -n "s/^$1=//p" "$UH/state"; }
wait_for() { # wait_for <seconds> <shell test>
  i=0; while ! eval "$2"; do i=$((i + 1)); [ "$i" -lt "$1" ] || return 1; sleep 1; done
}
[ "$(st status)" = ok ] && [ -f "$UH/mirror.git/HEAD" ] && [ "$(cat "$UH/checkout")" = "$CO" ] || fail "install: status, mirror, checkout file"
grep -q '"status":"ok"' "$LOGS/updater-status.json" || fail "install wrote no status for the app"
ok "install: mirror, state, status (home and app)"

run; [ "$RC" = 0 ] && [ ! -s "$T/out" ] || fail "idle run printed or failed"
[ -f "$LOGS/updater-heartbeat" ] || fail "no heartbeat"
f0=$(state last_fetch); [ "${f0:-0}" -gt 0 ] || fail "last GitHub check not kept"
sleep 1; ASSISTANT_FETCH_EVERY=240 run; export ASSISTANT_FETCH_EVERY=0; [ "$(state last_fetch)" = "$f0" ] || fail "checked GitHub again within 4 minutes"
ok "idle run is silent, leaves a heartbeat, checks GitHub at most every 4 minutes"

# Someone ran `npm ci` as root in the checkout: the update hands those files back.
mkdir -p "$CO/apps/web/node_modules/x"; touch "$CO/apps/web/node_modules/x/root-file"
chmod 555 "$CO/apps/web/node_modules/x"; chmod 444 "$CO/apps/web/node_modules/x/root-file"
asown sh -c "echo v2 > '$T/work/apps/web/page.txt'"; commit B
run; [ "$RC" = 0 ] || fail "web change"
[ "$(cat "$CO/apps/web/page.txt")" = v2 ] || fail "checkout not fast-forwarded"
[ "$(stat -c %u "$CO/apps/web/page.txt")" = "$OWNER" ] || fail "pulled file not owned by the checkout owner"
[ "$(llm_img)" = "$img0" ] || fail "terminal rebuilt for a web change"
[ "$(stat -c %u "$CO/apps/web/node_modules/x/root-file")" = "$OWNER" ] || fail "root-owned file not handed back"
[ "$(stat -c %u "$CO/.env")" = 0 ] || fail ".env changed owner"
[ "$(st status)" = ok ] && [ "$(st steps)" = 1 ] || fail "web change: want ok with 1 step (the code), got $(cat "$UH/status.json")"
ok "web-only change: checkout updated, nothing rebuilt, root-owned files handed back"

dockerfile 'LABEL v=2'; commit C
run; [ "$RC" = 0 ] && grep -q 'step 1/4: building terminal' "$T/out" || fail "image change"
img1=$(llm_img); [ "$img1" != "$img0" ] || fail "terminal not recreated"
grep -q '== .* step 3/4: starting terminal' "$LOGS/updater-build.log" || fail "build log has no steps"
ok "docker/terminal change: built, then code, then recreated, then checked (4 steps)"

dockerfile 'RUN false'; commit D
run; [ "$RC" = 1 ] && grep -q 'FAILED: building terminal failed' "$T/out" || fail "broken build not reported"
[ "$(llm_img)" = "$img1" ] || fail "broken build replaced the container"
[ "$(st status)" = failed ] || fail "status not failed"
asown git -C "$CO" log -1 --format=%s | grep -qx C || fail "the checkout moved although the build failed"
run; [ ! -s "$T/out" ] || fail "failed commit retried at once"
sed -i "s/^failed_at=.*/failed_at=$(( $(date +%s) - 1900 ))/" "$UH/state"
run; grep -q 'retry 2 of 3' "$T/out" || fail "failed commit not retried after 30 minutes"
[ "$(state fail_count)" = 2 ] || fail "fail count"
ok "broken build: old containers and code stay, reported, retried after 30 min, not at once"

dockerfile 'RUN sleep 60'; commit E
# An assignment in front of a function stays set afterwards in bash's sh mode (DSM's sh): reset it.
ASSISTANT_BUILD_TIMEOUT=5 run; unset ASSISTANT_BUILD_TIMEOUT
[ "$RC" = 1 ] && grep -q 'no end after its time limit' "$T/out" || fail "hung build not stopped"
[ ! -d "$UH/lock" ] || fail "lock left after a timeout"
ok "a hung build fails after its time limit and frees the lock"

# Killed halfway (a reboot, kill -9): the next run takes the lock over and resumes, skipping done steps.
# docker-compose.yml changes: every image is built (terminal, then worker: Compose sorts them), every service started.
asown mkdir -p "$T/work/docker/worker"
asown sh -c "printf 'FROM alpine:3.20\nRUN echo e2e-$P-${T##*.}\nRUN sleep 20\n' > '$T/work/docker/worker/Dockerfile'"
asown sh -c "printf '  worker:\n    build: ./docker/worker\n    command: [\"sleep\", \"infinity\"]\n' > '$T/worker.yml'"
asown sh -c "sed -i '/^volumes:/e cat $T/worker.yml' '$T/work/docker-compose.yml'"
dockerfile 'LABEL v=3'; commit F
bg; wait_for 60 'grep -q "building worker" "$UH/status.json" 2>/dev/null' || fail "never reached building worker: $(cat "$T/bg.out")"
pid=$(cat "$UH/lock/pid"); kill -9 "-$pid"; sleep 1
[ -d "$UH/lock" ] && [ "$(st status)" = updating ] && [ -n "$(state target)" ] || fail "no journal after the kill"
grep -q 'build:terminal' "$UH/state" || fail "build:terminal not journaled as done"
# Another run while the dead update's lock is there: it takes over and resumes.
run; [ "$RC" = 0 ] || fail "resume failed"
grep -q 'taking over the lock' "$T/out" && grep -q 'resuming after an interruption (attempt 2 of 3)' "$T/out" || fail "not resumed"
grep -q 'building terminal' "$T/out" && fail "resumed update rebuilt terminal (done before)"
grep -q 'step 2/5: building worker' "$T/out" || fail "resume did not continue at step 2"
[ "$(docker inspect -f '{{.State.Running}}' "$(dc ps -q worker)")" = true ] || fail "worker not started"
[ -z "$(state target)" ] && [ "$(st status)" = ok ] || fail "journal not cleared"
ok "update killed halfway: next run takes over the lock and resumes after the done steps"

# Two at once: a scheduled run during an update exits at once; a run from the host follows it.
dockerfile 'RUN sleep 8'; commit G
bg; wait_for 30 'grep -q "building terminal" "$UH/status.json" 2>/dev/null' || fail "G never started"
t0=$(date +%s); run; [ "$RC" = 0 ] && [ ! -s "$T/out" ] && [ $(( $(date +%s) - t0 )) -lt 5 ] || fail "second scheduled run did not leave at once"
run --now; grep -q 'following it' "$T/out" && grep -q 'that update ended: ok' "$T/out" || fail "--now did not follow the running update"
grep -q 'already at' "$T/out" || fail "--now after following did not check again"
ok "one update at a time: a scheduled run leaves, a run from the host follows it"

# Cancel from the host: the update and its build stop, the lock is freed, the old containers run on.
img2=$(llm_img)
dockerfile 'RUN sleep 120'; commit H
bg; wait_for 30 'grep -q "building terminal" "$UH/status.json" 2>/dev/null' || fail "H never started"
upid=$(cat "$UH/lock/pid")
sh "$UH/update.sh" cancel "$CO" > "$T/out" 2>&1 || fail "cancel"
sleep 1
! kill -0 "$upid" 2>/dev/null || fail "updater still running after cancel"
[ ! -d "$UH/lock" ] && [ "$(st status)" = failed ] && grep -q cancelled "$UH/status.json" || fail "cancel: lock or status"
[ "$(llm_img)" = "$img2" ] || fail "cancel replaced terminal"
run; [ ! -s "$T/out" ] || fail "cancelled update restarted by itself"
ok "cancel from the host: stopped, lock freed, not retried by itself"

# Cancel from the app (System settings writes cancel=<id>): the next run stops it.
bg --now; wait_for 30 'grep -q "building terminal" "$UH/status.json" 2>/dev/null' || fail "retry never started"
printf 'mode=auto\ncancel=c1\n' > "$LOGS/updater-control"
run; grep -q 'cancelled from the app' "$T/out" || fail "app cancel not handled"
[ ! -d "$UH/lock" ] || fail "lock after app cancel"
run; [ ! -s "$T/out" ] || fail "app cancel handled twice"
ok "cancel from the app: handled once by the next run"

# Manual mode: a run only reports what is waiting; "Update now" (request=<id>) updates, once.
dockerfile 'LABEL v=4'; commit I
printf 'mode=manual\n' > "$LOGS/updater-control"
run; [ "$(st status)" = available ] && grep -q 'update available' "$UH/status.json" || fail "manual: not available"
run; [ ! -s "$T/out" ] || fail "manual: said twice"
printf 'mode=manual\nrequest=r1\n' > "$LOGS/updater-control"
run; [ "$RC" = 0 ] && [ "$(st status)" = ok ] && [ "$(st request)" = r1 ] || fail "manual: request not deployed"
run; [ ! -s "$T/out" ] || fail "request handled twice"
ok "manual mode: available, then Update now deploys and is echoed back"

# Restarts asked first: terminal (where the Claude sessions run) keeps the previous version until
# "Restart now" in the app or `--restart` on the host; everything else is updated.
printf 'mode=auto\nrestarts=ask\n' > "$LOGS/updater-control"
imgA=$(llm_img)
asown sh -c "echo v4b > '$T/work/apps/web/page.txt'"; dockerfile 'LABEL v=4b'; commit I2
run; [ "$RC" = 0 ] && grep -q 'terminal wait for a restart' "$T/out" || fail "held restart not reported"
[ "$(llm_img)" = "$imgA" ] && [ "$(cat "$CO/apps/web/page.txt")" = v4b ] || fail "terminal recreated, or the code not updated"
[ "$(st pendingRestart)" = terminal ] && [ "$(st status)" = ok ] || fail "status has no pending restart"
run; [ ! -s "$T/out" ] || fail "held restart said twice"
printf 'mode=auto\nrestarts=ask\nrestart=x1\n' > "$LOGS/updater-control"
run; [ "$RC" = 0 ] && grep -q 'restarted terminal' "$T/out" || fail "Restart now not done"
imgB=$(llm_img); [ "$imgB" != "$imgA" ] && [ -z "$(st pendingRestart)" ] && [ "$(st restartRequest)" = x1 ] || fail "terminal not recreated by the restart"
run; [ ! -s "$T/out" ] || fail "restart request handled twice"
dockerfile 'LABEL v=4c'; commit I3
run; [ "$(llm_img)" = "$imgB" ] || fail "held again: terminal recreated"
sh "$UH/update.sh" run --restart "$CO" < /dev/null > "$T/out" 2>&1 || fail "--restart"
[ "$(llm_img)" != "$imgB" ] && [ -z "$(st pendingRestart)" ] || fail "--restart did not restart terminal"
ok "restarts asked first: terminal waits for Restart now (app) or --restart (host), the rest is updated"

# A terminal: the bare command updates now, with a progress bar, and asks before restarting terminal.
asown sh -c "echo v5 > '$T/work/apps/web/page.txt'"; dockerfile 'LABEL v=5'; commit J
imgC=$(llm_img)
(while sleep 2; do echo y; done) | ASSISTANT_PROMPT_TIMEOUT=60 script -qec "sh $UH/update.sh $CO" /dev/null > "$T/out" 2>&1 || fail "terminal run"
grep -q '\[#*\.*\] [0-9]/2 ' "$T/out" && grep -q 'done: ' "$T/out" || fail "no progress bar in a terminal"
grep -q 'Restart now?' "$T/out" && [ "$(llm_img)" != "$imgC" ] || fail "terminal did not ask, or did not restart on yes"
printf 'mode=auto\n' > "$LOGS/updater-control"
ok "terminal: the plain command updates now with a progress bar and asks before restarting terminal"

# Claude edits docker-compose.yml in the checkout to mount the host root: refused, nothing started.
asown sed -i 's#\[logs:/logs\]#[logs:/logs, /:/host]#' "$CO/docker-compose.yml"
printf 'mode=auto\n' > "$LOGS/updater-control"
dockerfile 'LABEL v=6'; commit K
run; grep -q 'differs from main' "$T/out" || fail "tampered compose applied"
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$(dc ps -q terminal)" | grep -q /host && fail "host mounted"
asown git -C "$CO" checkout -q docker-compose.yml
ok "tampered docker-compose.yml in the checkout is refused"

# A hook and an fsmonitor planted in the checkout run in the throwaway container, not on the host.
asown sh -c "printf '#!/bin/sh\ntouch $T/pwned-hook\n' > '$CO/.git/hooks/post-merge'; chmod +x '$CO/.git/hooks/post-merge'"
asown git -C "$CO" config core.fsmonitor "touch $T/pwned-fsmonitor; false"
asown sh -c "echo v6 > '$T/work/apps/web/page.txt'"; commit L
run --now; [ "$RC" = 0 ] || fail "deploy after fix"
[ ! -e "$T/pwned-hook" ] && [ ! -e "$T/pwned-fsmonitor" ] || fail "checkout code ran on the host"
asown git -C "$CO" config --unset core.fsmonitor; rm -f "$CO/.git/hooks/post-merge"
ok "hooks and git config in the checkout never run on the host"

# Local changes where the update changes files: paused before any build, said once, then it goes on.
asown sh -c "echo local > '$CO/apps/web/page.txt'"
asown sh -c "echo v7 > '$T/work/apps/web/page.txt'"; dockerfile 'LABEL v=7'; commit M
img3=$(llm_img)
run; [ "$(st status)" = blocked ] && grep -q 'uncommitted changes' "$T/out" || fail "local change not blocking"
[ "$(llm_img)" = "$img3" ] && ! grep -q building "$T/out" || fail "built although blocked"
run; [ ! -s "$T/out" ] || fail "blocked said twice"
asown git -C "$CO" checkout -q apps/web/page.txt
run; [ "$RC" = 0 ] && [ "$(st status)" = ok ] || fail "after the local change was dropped"
asown git -C "$CO" -c user.email=c@x -c user.name=c commit -q --allow-empty -m local
asown sh -c "echo v8 > '$T/work/apps/web/page.txt'"; commit N
run; grep -q 'not on GitHub' "$T/out" || fail "divergence"
asown git -C "$CO" reset -q --hard HEAD~1
run; [ "$RC" = 0 ] || fail "after reset"
ok "local changes or commits pause it before any build, until fixed"

# Locks: an older updater's (pid only) is respected while its pid lives; another boot's is taken over.
sleep 300 & sp=$!
mkdir "$UH/lock"; echo "$sp" > "$UH/lock/pid"
asown sh -c "echo v9 > '$T/work/apps/web/page.txt'"; commit O
run; [ ! -s "$T/out" ] && [ -d "$UH/lock" ] || fail "live legacy lock not respected"
kill "$sp"; wait "$sp" 2>/dev/null || true
echo other-boot > "$UH/lock/boot"; echo "$$" > "$UH/lock/pid"; echo 1 > "$UH/lock/start"
run; [ "$RC" = 0 ] && grep -q 'taking over the lock' "$T/out" || fail "lock of another boot not taken over"
ok "locks: a live one is respected, one of another boot or a dead pid is taken over"

# A service gone from main's compose file (renamed, merged): its containers are removed, by label; a
# service from another compose file of the project (an extension's) stays.
printf 'services:\n  ext:\n    image: alpine:3.20\n' > "$CO/ext.yml"; echo "COMPOSE_FILE=docker-compose.yml:ext.yml" >> "$CO/.env"
docker run -d --name "$P-ext-1" --label "com.docker.compose.project=$P" --label com.docker.compose.service=ext alpine:3.20 sleep 600 >/dev/null
docker run -d --name "$P-stray-1" --label "com.docker.compose.project=$P" --label com.docker.compose.service=stray alpine:3.20 sleep 600 >/dev/null
asown sed -i 's/^  worker:/  worker2:/' "$T/work/docker-compose.yml"; commit R1
run; [ "$RC" = 0 ] && grep -q 'removing worker' "$T/out" || fail "removed service not removed"
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$P" --filter label=com.docker.compose.service=worker)" ] || fail "worker still there"
[ "$(docker inspect -f '{{.State.Running}}' "$(dc ps -q worker2)")" = true ] || fail "worker2 not started"
[ "$(docker inspect -f '{{.State.Running}}' "$P-ext-1")" = true ] || fail "the extension's container was removed"
! docker inspect "$P-stray-1" >/dev/null 2>&1 || fail "a container of a service no compose file has was left"
# terminal renamed (as claude was to terminal) with restarts=ask: the new name waits for Restart now, and terminal goes with it.
printf 'mode=auto\nrestarts=ask\n' > "$LOGS/updater-control"
asown sed -i 's/^  terminal:/  agent:/' "$T/work/docker-compose.yml"; commit R2
run; [ "$RC" = 0 ] && [ "$(st pendingRestart)" = 'agent terminal' ] || fail "rename: agent and terminal not waiting for the restart"
running() { docker ps -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.service=$1"; }
[ -n "$(running terminal)" ] && [ -z "$(running agent)" ] || fail "rename: switched without asking"
printf 'mode=auto\nrestarts=ask\nrestart=x2\n' > "$LOGS/updater-control"
run; [ "$RC" = 0 ] && grep -q 'restarted' "$T/out" || fail "rename: restart failed"
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$P" --filter label=com.docker.compose.service=terminal)" ] || fail "terminal still there"
[ -n "$(running agent)" ] || fail "agent not running"
printf 'mode=auto\n' > "$LOGS/updater-control"
asown sh -c "echo v9b > '$T/work/apps/web/page.txt'"; commit R3
run; [ "$RC" = 0 ] && [ "$(cat "$CO/apps/web/page.txt")" = v9b ] || fail "no update after the rename (git container image?)"
docker rm -f "$P-ext-1" >/dev/null
ok "a service gone from compose is removed (with the held restart when it is renamed), extensions' stay"

# The updater updates itself from main and the new copy runs the same update.
asown sh -c "sed -i 's/^MAX_ATTEMPTS=3 /MAX_ATTEMPTS=3 # v2/' '$T/work/scripts/update.sh'"
asown sh -c "echo v10 > '$T/work/apps/web/page.txt'"; commit P
run; grep -q 'updated itself' "$T/out" && grep -q 'updated to' "$T/out" || fail "self-update"
grep -q '# v2' "$UH/update.sh" || fail "installed copy not replaced"
ok "the updater updates itself from main and finishes the update with the new copy"

# An older install: its scheduled task runs <home>/auto-update.sh run <checkout>; it hands over.
rm "$UH/update.sh"; cp "$HERE/auto-update.sh" "$UH/auto-update.sh"
asown sh -c "echo v11 > '$T/work/apps/web/page.txt'"; commit Q
sh "$UH/auto-update.sh" run "$CO" < /dev/null > "$T/out" 2>&1 || fail "legacy task"
[ -f "$UH/update.sh" ] && [ "$(cat "$CO/apps/web/page.txt")" = v11 ] || fail "legacy task did not hand over"
ok "an older scheduled task (auto-update.sh run) hands over to update.sh"

# A home the older updater handed over has no checkout file; the schedule runs update.sh bare: it finds
# the checkout by the home's name (<checkout>-updater) and writes the file back.
rm -f "$UH/checkout"
ASSISTANT_UPDATER_HOME= sh "$UH/update.sh" status > "$T/out" 2>&1 && grep -q 'running commit' "$T/out" || fail "bare run did not find the checkout"
[ "$(cat "$UH/checkout")" = "$CO" ] || fail "checkout file not written back"
grep -q 'last run: 20' "$T/out" || fail "status shows no last run"
# A run that cannot start says why where someone will see it (the schedule's output goes nowhere).
echo /nonexistent > "$UH/checkout"
ASSISTANT_UPDATER_HOME= sh "$UH/update.sh" < /dev/null > "$T/out" 2>&1 && fail "ran without a checkout"
grep -q 'not an assistant checkout' "$UH/last-error" || fail "error of a bare run not kept"
echo "$CO" > "$UH/checkout"
ok "a bare run finds its checkout (file, or the home's name) and keeps its errors"

sh "$UH/update.sh" status "$CO" > "$T/out" 2>&1; grep -q 'ok: updated to' "$T/out" || fail "status"
grep -q 'updated to' "$LOGS/updater.log" || fail "no log"
ok "status and log"

# A container plants symlinks in the logs volume (it can write there): root replaces them, never writes,
# chmods or chowns through them.
victim=$T/victim; echo keep > "$victim"; chmod 600 "$victim"
for n in updater-heartbeat updater-status.json updater.log updater-build.log web.log; do rm -f "$LOGS/$n"; ln -s "$victim" "$LOGS/$n"; done
asown sh -c "echo v12 > '$T/work/apps/web/page.txt'"; commit S
run; [ "$RC" = 0 ] || fail "update with planted symlinks failed"
[ "$(cat "$victim")" = keep ] && [ "$(stat -c '%u %a' "$victim")" = "0 600" ] || fail "a write went through a symlink: $(stat -c '%u %a' "$victim") $(head -c 80 "$victim")"
for n in updater-heartbeat updater-status.json updater.log; do [ -f "$LOGS/$n" ] && [ ! -L "$LOGS/$n" ] || fail "$n still a symlink"; done
grep -q 'updated to' "$LOGS/updater.log" || fail "log lost its history"
ok "symlinks planted in the logs volume are replaced, never followed"
echo "all passed"
