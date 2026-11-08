#!/bin/sh
# Copies the data of an older install (the single-repo assistant, with health in the shell) into this one:
# profiles, the apps' data and settings, dashboard layouts, the health data and the Garmin logins.
#
#   sudo sh scripts/import-legacy.sh <old checkout> [--no-garmin-login]
#   e.g. sudo sh scripts/import-legacy.sh /volume1/docker/assistant
#
# Both stacks must be running; this one with the health extension installed. A dump of this database is
# written to backups/ first (restore: pg_restore --clean). Rows that already exist here (same key) are kept.
# Not copied: sessions, the app password, extension secrets (encrypted with the old SECRETS_KEY: enter
# them again in System settings). The Garmin logins only work with the old TOKEN_ENCRYPTION_KEY, so it
# is copied into this .env when this install has none yet; --no-garmin-login skips both (log in again).
set -eu
PATH=$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin

OLD=${1:?usage: sudo sh scripts/import-legacy.sh <old checkout> [--no-garmin-login]}
GARMIN=yes
[ "${2:-}" = --no-garmin-login ] && GARMIN=no
NEW=$(cd "$(dirname "$0")/.." && pwd)
OLD=$(cd "$OLD" && pwd)

say() { printf '\033[1m[import]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[import]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$OLD" != "$NEW" ] || die "the old checkout is this one"
[ -f "$OLD/.env" ] && [ -f "$OLD/docker-compose.yml" ] || die "$OLD is not an assistant checkout with a .env"
[ -f "$NEW/.env" ] || die "run ./install.sh here first"
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
env_of() { sed -n "s/^$2=//p" "$1/.env" | tail -n 1; }
OU=$(env_of "$OLD" POSTGRES_USER); OU=${OU:-assistant}; OD=$(env_of "$OLD" POSTGRES_DB); OD=${OD:-assistant}
NU=$(env_of "$NEW" POSTGRES_USER); NU=${NU:-assistant}; ND=$(env_of "$NEW" POSTGRES_DB); ND=${ND:-assistant}
old_db() { (cd "$OLD" && $DC exec -T db "$@"); }
new_db() { (cd "$NEW" && $DC exec -T db "$@"); }
old_sql() { old_db psql -U "$OU" -d "$OD" -v ON_ERROR_STOP=1 -tAc "$1"; }
new_sql() { new_db psql -U "$NU" -d "$ND" -v ON_ERROR_STOP=1 -tAc "$1"; }

old_sql 'SELECT 1' >/dev/null 2>&1 || die "the old database is not running: cd $OLD && $DC up -d db"
new_sql 'SELECT 1' >/dev/null 2>&1 || die "this database is not running: $DC up -d"
[ -n "$(old_sql "SELECT to_regclass('health.synced_metric_days')")" ] || die "the old database has no health schema"
[ -n "$(new_sql "SELECT to_regclass('health.synced_metric_days')")" ] ||
  die "install the health extension here first: $DC exec claude node scripts/ext.mjs install health && sudo ./install.sh"

mkdir -p "$NEW/backups"
backup="$NEW/backups/before-import-$(date +%Y%m%d-%H%M%S).dump"
umask 077
new_db pg_dump -U "$NU" -d "$ND" -Fc > "$backup"
say "backup of this database: $backup"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# INSERTs with column names (the column order may differ) that skip rows already here.
old_db pg_dump -U "$OU" -d "$OD" --data-only --column-inserts --on-conflict-do-nothing \
  -t core.profiles -t core.extension_kv -t core.extension_settings -t core.extension_config \
  -t core.dashboard_layout -t 'health.*' > "$tmp/data.sql"
say "copying $(grep -c '^INSERT' "$tmp/data.sql") rows"
new_db psql -U "$NU" -d "$ND" -v ON_ERROR_STOP=1 -q -1 < "$tmp/data.sql" > /dev/null

if [ "$GARMIN" = yes ] && [ -n "$(old_sql "SELECT to_regclass('secrets.garmin_tokens')")" ]; then
  if [ "$(new_sql 'SELECT count(*) FROM health.secret_garmin_tokens')" != 0 ]; then
    say "Garmin logins: this install has its own already, keeping them"
  elif [ "$(old_sql 'SELECT count(*) FROM secrets.garmin_tokens')" = 0 ]; then
    say "Garmin logins: none in the old install"
  else
    old_db psql -U "$OU" -d "$OD" -v ON_ERROR_STOP=1 -c \
      "COPY (SELECT user_id, ciphertext, updated_at FROM secrets.garmin_tokens) TO STDOUT" > "$tmp/tokens"
    new_db psql -U "$NU" -d "$ND" -v ON_ERROR_STOP=1 -q -c \
      "COPY health.secret_garmin_tokens (user_id, ciphertext, updated_at) FROM STDIN" < "$tmp/tokens"
    key=$(env_of "$OLD" TOKEN_ENCRYPTION_KEY)
    sed -i '/^TOKEN_ENCRYPTION_KEY=/d' "$NEW/.env"
    printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$key" >> "$NEW/.env"
    (cd "$NEW" && $DC up -d garmin-sync >/dev/null 2>&1) || true
    say "Garmin logins copied, with the old install's key (TOKEN_ENCRYPTION_KEY in .env)"
  fi
fi

say "done: $(new_sql 'SELECT string_agg(id, $$, $$ ORDER BY id) FROM core.profiles') now in core.profiles"
say "Stop the old stack when you are happy (cd $OLD && $DC stop), so two syncs do not share one Garmin account."
