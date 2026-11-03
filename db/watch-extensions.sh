#!/bin/sh
# Applies migrations again whenever the installed extensions or any migration file change, so an
# extension that Claude installs (scripts/ext.mjs) gets its schema and role without a human
# `docker compose up` (spec 002). The one-shot `migrate` service still runs first at startup.
set -u
INTERVAL=${EXT_MIGRATE_INTERVAL:-15}
EXT=${EXTENSIONS_DIR:-/extensions}
MIG=${MIGRATIONS_DIR:-/migrations}
MIGRATE=${MIGRATE_SH:-/migrate.sh}

state() {
  {
    cat "$EXT/installed.json" 2>/dev/null
    find "$MIG" "$EXT" -name '*.sql' -not -path '*/.trash/*' 2>/dev/null | sort | xargs -r md5sum
  } | md5sum
}

last=$(state)
echo "[ext-migrate] watching extensions every ${INTERVAL}s"
while sleep "$INTERVAL"; do
  now=$(state)
  [ "$now" = "$last" ] && continue
  last=$now
  echo "[ext-migrate] $(date -u +%FT%TZ) change detected, applying migrations"
  sh "$MIGRATE" || echo "[ext-migrate] migrate failed; fix the migration, the next change retries"
done
