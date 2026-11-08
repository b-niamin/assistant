#!/bin/sh
# End-to-end test of scripts/auto-update.sh against a throwaway compose project (needs Docker and root).
#   sudo sh scripts/auto-update.e2e.sh
# It builds a fake "GitHub" repo, a checkout owned by OWNER_UID, a two-service project (`claude` built
# from docker/claude, `web` from an image), installs the updater and walks through: idle tick, a
# web-only change, an image change, a broken build, a tampered compose file, a hook planted in the
# checkout, local divergence and the updater updating itself.
set -eu
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
SRC_SCRIPT=$(cd "$(dirname "$0")" && pwd)/auto-update.sh
OWNER=${OWNER_UID:-1000}
T=$(mktemp -d /tmp/au-e2e.XXXXXX)
P=au-e2e-$$
CO=$T/$P
UH=$T/$P-updater
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; }
asown() { sudo -n -H -u "#$OWNER" "$@"; }
gito() { asown git -C "$T/work" "$@"; }
cleanup() {
  docker compose -p "$P" --project-directory "$CO" -f "$CO/docker-compose.yml" --env-file "$CO/.env" down -v --rmi local >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup EXIT
chown "$OWNER" "$T"

# "GitHub" and a working clone that plays the developer merging PRs.
asown git init -q --bare -b main "$T/origin.git"
asown git clone -q "$T/origin.git" "$T/work"
gito config user.email t@example.com; gito config user.name test
asown mkdir -p "$T/work/docker/claude" "$T/work/apps/web" "$T/work/scripts"
asown sh -c "cat > '$T/work/docker-compose.yml'" <<'YML'
services:
  claude:
    build: ./docker/claude
    command: ['sleep', 'infinity']
    volumes: [logs:/logs]
  web:
    image: alpine:3.20
    command: ['sleep', 'infinity']
    volumes: [logs:/logs, ./apps/web:/app]
volumes:
  logs:
YML
asown sh -c "printf 'FROM alpine/git:v2.45.2\nENTRYPOINT []\n' > '$T/work/docker/claude/Dockerfile'"
asown sh -c "echo v1 > '$T/work/apps/web/page.txt'; printf '.env\n' > '$T/work/.gitignore'"
asown cp "$SRC_SCRIPT" "$T/work/scripts/auto-update.sh"
gito add -A; gito commit -qm A; gito push -q origin main
commit() { gito add -A; gito commit -qm "$1"; gito push -q origin main; }

# The deployed checkout, running.
asown git clone -q "$T/origin.git" "$CO"
echo "HOST_UID=$OWNER" > "$CO/.env"; chmod 600 "$CO/.env" # root-owned, like install.sh writes it
dc() { docker compose -p "$P" --project-directory "$CO" -f "$CO/docker-compose.yml" --env-file "$CO/.env" "$@"; }
dc up -d --build --quiet-pull >/dev/null 2>&1
claude_img() { docker inspect -f '{{.Image}}' "$(dc ps -q claude)"; }
img0=$(claude_img)

export ASSISTANT_UPDATER_HOME=$UH ASSISTANT_COMPOSE_PROJECT=$P ASSISTANT_REPO=$T/origin.git
sh "$CO/scripts/auto-update.sh" install "$CO" >/dev/null
run() { sh "$UH/auto-update.sh" run "$CO" > "$T/out" 2>&1 || true; }
status() { docker run --rm -v "${P}_logs:/logs" alpine:3.20 cat /logs/updater-status.json; }
status | grep -q '"status":"ok"' || fail "install wrote no status"
ok "install: mirror, state, status"

run; [ ! -s "$T/out" ] || fail "idle tick printed: $(cat "$T/out")"
ok "idle tick is silent"

# Someone ran `npm ci` as root in the checkout: the next deploy hands those files back.
mkdir -p "$CO/apps/web/node_modules/x"; touch "$CO/apps/web/node_modules/x/root-file"
chmod 555 "$CO/apps/web/node_modules/x"; chmod 444 "$CO/apps/web/node_modules/x/root-file" # like r-xr-xr-x+ on DSM
asown sh -c "echo v2 > '$T/work/apps/web/page.txt'"; commit B
run; grep -q 'actions: none' "$T/out" || fail "web change: $(cat "$T/out")"
[ "$(cat "$CO/apps/web/page.txt")" = v2 ] || fail "checkout not fast-forwarded"
[ "$(stat -c %u "$CO/apps/web/page.txt")" = "$OWNER" ] || fail "pulled file not owned by the checkout owner"
[ "$(claude_img)" = "$img0" ] || fail "claude rebuilt for a web change"
[ "$(stat -c %u "$CO/apps/web/node_modules/x/root-file")" = "$OWNER" ] || fail "root-owned file not handed back"
[ "$(stat -c %u "$CO/.env")" = 0 ] || fail ".env changed owner"
asown touch "$CO/apps/web/node_modules/x/new" || fail "read-only directory not made writable"
ok "web-only change: checkout updated, nothing rebuilt, root-owned files handed back"

asown sh -c "echo 'LABEL v=2' >> '$T/work/docker/claude/Dockerfile'"; commit C
run; grep -q 'build:claude' "$T/out" && grep -q 'deployed' "$T/out" || fail "image change: $(cat "$T/out")"
img1=$(claude_img); [ "$img1" != "$img0" ] || fail "claude not recreated"
ok "docker/claude change: image rebuilt, container recreated"

asown sh -c "echo 'RUN false' >> '$T/work/docker/claude/Dockerfile'"; commit D
run; grep -q 'FAILED' "$T/out" || fail "broken build not reported: $(cat "$T/out")"
[ "$(claude_img)" = "$img1" ] || fail "broken build replaced the container"
[ "$(docker inspect -f '{{.State.Running}}' "$(dc ps -q claude)")" = true ] || fail "claude not running"
status | grep -q '"status":"failed"' || fail "status not failed"
run; [ ! -s "$T/out" ] || fail "failed commit retried: $(cat "$T/out")"
ok "broken build: old container keeps running, reported once, not retried"

# Claude edits docker-compose.yml in the checkout (uncommitted) to mount the host root: refused.
asown sed -i 's#\[logs:/logs\]#[logs:/logs, /:/host]#' "$CO/docker-compose.yml"
asown sed -i 's/RUN false/LABEL v=3/' "$T/work/docker/claude/Dockerfile"; commit E
run; grep -q 'differs from main' "$T/out" || fail "tampered compose applied: $(cat "$T/out")"
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$(dc ps -q claude)" | grep -q /host && fail "host mounted"
asown git -C "$CO" checkout -q docker-compose.yml
ok "tampered docker-compose.yml in the checkout is refused"

# A hook and an fsmonitor planted in the checkout run in the throwaway container, not on the host.
asown sh -c "printf '#!/bin/sh\ntouch $T/pwned-hook\n' > '$CO/.git/hooks/post-merge'; chmod +x '$CO/.git/hooks/post-merge'"
asown git -C "$CO" config core.fsmonitor "touch $T/pwned-fsmonitor; false"
asown sh -c "echo v3 > '$T/work/apps/web/page.txt'"; commit F
FORCE=1 run; grep -q 'deployed' "$T/out" || fail "deploy after fix: $(cat "$T/out")"
[ ! -e "$T/pwned-hook" ] && [ ! -e "$T/pwned-fsmonitor" ] || fail "checkout code ran on the host"
asown git -C "$CO" config --unset core.fsmonitor; rm -f "$CO/.git/hooks/post-merge"
ok "hooks and git config in the checkout never run on the host"

# Local commits that are not on GitHub: blocked, reported once.
asown git -C "$CO" -c user.email=c@x -c user.name=c commit -q --allow-empty -m local
asown sh -c "echo v4 > '$T/work/apps/web/page.txt'"; commit G
run; grep -q 'not on GitHub' "$T/out" || fail "divergence: $(cat "$T/out")"
status | grep -q '"status":"blocked"' || fail "status not blocked"
run; [ ! -s "$T/out" ] || fail "blocked reported twice"
asown git -C "$CO" reset -q --hard HEAD~1
run; grep -q 'deployed' "$T/out" || fail "after reset: $(cat "$T/out")"
ok "diverged checkout is blocked until fixed"

asown sh -c "echo '# v2' >> '$T/work/scripts/auto-update.sh'"; commit H
run; grep -q 'updated the updater itself' "$T/out" || fail "self-update: $(cat "$T/out")"
tail -n 1 "$UH/auto-update.sh" | grep -q '# v2' || fail "installed copy not replaced"
ok "the updater updates itself from main"

docker run --rm -v "${P}_logs:/logs" alpine:3.20 cat /logs/updater.log | grep -q 'deployed' || fail "no log"
ok "log in the logs volume"
echo "all passed"
