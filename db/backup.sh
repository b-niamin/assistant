#!/bin/sh
# Backups (spec 004, docs/install.md "Backups"). Runs in the `backup` service; `sh /backup.sh now` makes
# one at once (beni.sh backup), and so does a /logs/backup-request file (System settings, Back up now). Each backup is one folder in /backups (BACKUP_DIR on the host, outside
# the checkout), enough to bring the instance back on a new machine:
#   db.dump          pg_dump -Fc, checked with pg_restore --list before it counts
#   env              the instance's .env (the keys that decrypt stored secrets live only there)
#   extensions.tgz   the installed extensions, code and installed.json (git-ignored, in no repo)
#   manifest.json    when, versions, sizes
# A backup is written under .tmp-<stamp> and renamed only when complete, so a folder that exists is whole.
# Kept: the last BACKUP_KEEP_DAILY days, BACKUP_KEEP_WEEKLY Sundays, BACKUP_KEEP_MONTHLY 1sts; old ones go
# only after a backup succeeded, so failures never eat the good copies. Every run writes
# /logs/backup-status.json (read by the app and beni.sh doctor) and appends to /logs/backup.log.
set -u
OUT=${BACKUP_OUT:-/backups}
LOGS=${BACKUP_LOGS:-/logs}
HOUR=${BACKUP_HOUR:-3}
KEEP_DAILY=${BACKUP_KEEP_DAILY:-7}
KEEP_WEEKLY=${BACKUP_KEEP_WEEKLY:-4}
KEEP_MONTHLY=${BACKUP_KEEP_MONTHLY:-6}
umask 077

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOGS/backup.log"; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }

# The status file: never follow a link someone planted, write a new file and rename it.
status() { # $1 = ok|failed|running, $2 = message, $3 = backup name (ok only)
  prev_ok=$(sed -n 's/.*"lastOk": *"\([^"]*\)".*/\1/p' "$LOGS/backup-status.json" 2>/dev/null)
  prev_name=$(sed -n 's/.*"lastName": *"\([^"]*\)".*/\1/p' "$LOGS/backup-status.json" 2>/dev/null)
  last_ok=$prev_ok; last_name=$prev_name
  if [ "$1" = ok ]; then last_ok=$(iso); last_name=$3; fi
  count=$(find "$OUT" -maxdepth 1 -type d -name 'beni-*' 2>/dev/null | wc -l | tr -d ' ')
  st_tmp="$LOGS/.backup-status.$$"
  rm -f "$st_tmp"
  printf '{"status":"%s","at":"%s","message":"%s","lastOk":"%s","lastName":"%s","count":%s,"hour":%s}\n' \
    "$1" "$(iso)" "$(json_str "$2")" "$last_ok" "$last_name" "${count:-0}" "$HOUR" > "$st_tmp" && mv -f "$st_tmp" "$LOGS/backup-status.json"
}

backup_once() {
  stamp=$(date +%Y-%m-%d_%H%M)
  name="beni-$stamp"
  tmp="$OUT/.tmp-$stamp"
  mkdir -p "$OUT" || { log "FAILED: cannot create $OUT"; status failed "cannot create the backup folder"; return 1; }
  rm -rf "$tmp" && mkdir "$tmp" || { log "FAILED: cannot write to $OUT"; status failed "cannot write to the backup folder"; return 1; }
  status running "backing up" ""
  if ! pg_dump -Fc -f "$tmp/db.dump" 2>"$tmp/err"; then
    msg=$(head -c 300 "$tmp/err"); rm -rf "$tmp"
    log "FAILED: pg_dump: $msg"; status failed "database dump failed: $msg"; return 1
  fi
  if ! pg_restore --list "$tmp/db.dump" >/dev/null 2>"$tmp/err"; then
    msg=$(head -c 300 "$tmp/err"); rm -rf "$tmp"
    log "FAILED: the dump does not read back: $msg"; status failed "the dump does not read back"; return 1
  fi
  if [ -f /instance/.env ]; then cp /instance/.env "$tmp/env"; else log "warning: no .env mounted, the backup lacks the keys"; fi
  if [ -d /instance/extensions ]; then
    tar -czf "$tmp/extensions.tgz" -C /instance --exclude='*/node_modules' --exclude='*/.venv' --exclude='*/__pycache__' extensions 2>"$tmp/err" ||
      { msg=$(head -c 300 "$tmp/err"); rm -rf "$tmp"; log "FAILED: extensions: $msg"; status failed "extensions archive failed: $msg"; return 1; }
  fi
  rm -f "$tmp/err"
  db_size=$(wc -c < "$tmp/db.dump" | tr -d ' ')
  pg=$(pg_dump --version | sed 's/[^0-9.]*//')
  printf '{"name":"%s","at":"%s","postgres":"%s","dbBytes":%s,"env":%s,"extensions":%s,"arch":"%s"}\n' \
    "$name" "$(iso)" "$pg" "$db_size" "$([ -f "$tmp/env" ] && echo true || echo false)" \
    "$([ -f "$tmp/extensions.tgz" ] && echo true || echo false)" "$(uname -m)" > "$tmp/manifest.json"
  rm -rf "${OUT:?}/$name"
  mv "$tmp" "$OUT/$name" || { log "FAILED: cannot finish $name"; status failed "cannot finish the backup"; return 1; }
  prune
  log "ok $name (database $db_size bytes)"
  status ok "ok" "$name"
}

# Keep: the newest KEEP_DAILY backups of distinct days, KEEP_WEEKLY Sundays, KEEP_MONTHLY 1sts.
prune() {
  keep=$(mktemp)
  ls -1 "$OUT" 2>/dev/null | grep -E '^beni-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | sort -r > "$keep.all"
  # newest per day
  awk -F'[-_]' '!seen[$2"-"$3"-"$4]++' "$keep.all" > "$keep.days"
  head -n "$KEEP_DAILY" "$keep.days" >> "$keep"
  n_week=0; n_month=0
  while read -r b; do
    d=$(echo "$b" | sed -E 's/^beni-([0-9-]{10})_.*/\1/')
    if [ "$n_week" -lt "$KEEP_WEEKLY" ] && [ "$(date -d "$d" +%u 2>/dev/null)" = 7 ]; then echo "$b" >> "$keep"; n_week=$((n_week + 1)); fi
    if [ "$n_month" -lt "$KEEP_MONTHLY" ] && [ "${d##*-}" = 01 ]; then echo "$b" >> "$keep"; n_month=$((n_month + 1)); fi
  done < "$keep.days"
  while read -r b; do
    grep -qx "$b" "$keep" || { rm -rf "${OUT:?}/$b"; log "removed old $b"; }
  done < "$keep.all"
  # Half-written leftovers of a killed run.
  find "$OUT" -maxdepth 1 -name '.tmp-*' -mmin +120 -exec rm -rf {} + 2>/dev/null
  rm -f "$keep" "$keep.all" "$keep.days"
}

# /logs/*.log grow with every line the services write (audit M5): once a day, one over 5 MB keeps its
# newest 1 MB. Cut in place, so a writer appending to it (tee -a) goes on; links are left alone.
trim_logs() {
  for f in "$LOGS"/*.log; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    [ "$(wc -c < "$f")" -gt 5242880 ] || continue
    t=$(mktemp) || continue
    tail -c 1048576 "$f" | sed 1d > "$t" && cat "$t" > "$f" && log "trimmed $(basename "$f") to its newest 1 MB"
    rm -f "$t"
  done
}

# Seconds until the next BACKUP_HOUR:00 (local time, TZ).
until_next() {
  now=$(date +%s)
  today=$(date +%Y-%m-%d)
  next=$(date -d "$today $(printf %02d "$HOUR"):00:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  echo $((next - now))
}

# The last good backup is older than a day (or there is none): make one now, not at the next hour.
overdue() {
  last=$(ls -1 "$OUT" 2>/dev/null | grep -E '^beni-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$' | sort | tail -n 1)
  [ -z "$last" ] && return 0
  [ -n "$(find "$OUT/$last" -maxdepth 0 -mmin +1500 2>/dev/null)" ]
}

mkdir -p "$LOGS"
until pg_isready -q; do sleep 2; done
if [ "${1:-}" = now ]; then backup_once; exit $?; fi
# Every minute: due at BACKUP_HOUR, or asked for from System settings ("Back up now" writes backup-request).
next=$(( $(date +%s) + $(until_next) ))
if overdue; then next=0; fi
while true; do
  if [ -e "$LOGS/backup-request" ] || [ "$(date +%s)" -ge "$next" ]; then
    rm -f "$LOGS/backup-request"
    if backup_once; then next=$(( $(date +%s) + $(until_next) )); else next=$(( $(date +%s) + 1800 )); fi
    trim_logs
  fi
  sleep 60
done
