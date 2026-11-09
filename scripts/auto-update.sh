#!/bin/sh
# Replaced by scripts/update.sh (spec 006). Kept so that a scheduled task set up for the older updater
# (`sh <checkout>-updater/auto-update.sh run <checkout>`) keeps working: the older copy updates itself to
# this file, which hands over to update.sh (taken from the private mirror, never from the checkout).
set -u
PATH=/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH:-}
here=$(cd "$(dirname "$0")" && pwd)
if [ -d "$here/mirror.git" ]; then
  # <home>: bring in update.sh from main once.
  if [ ! -f "$here/update.sh" ]; then
    u=$(stat -c %u "$here/mirror.git")
    if [ "$(id -u)" = "$u" ]; then git --git-dir="$here/mirror.git" show "refs/heads/${ASSISTANT_BRANCH:-main}:scripts/update.sh"
    else sudo -n -H -u "#$u" git --git-dir="$here/mirror.git" show "refs/heads/${ASSISTANT_BRANCH:-main}:scripts/update.sh"; fi > "$here/update.sh.new" 2>/dev/null &&
      sh -n "$here/update.sh.new" && chmod 755 "$here/update.sh.new" && mv "$here/update.sh.new" "$here/update.sh"
    rm -f "$here/update.sh.new"
  fi
  [ -f "$here/update.sh" ] || { echo "[auto-update] no update.sh in $here: run sudo ./beni.sh update in the checkout" >&2; exit 1; }
  # A run from the schedule stays a scheduled run (no terminal = no forced update).
  [ "${1:-}" != run ] || shift
  exec sh "$here/update.sh" run "$@"
fi
exec sh "$here/update.sh" "$@"
