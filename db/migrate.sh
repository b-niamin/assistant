#!/bin/sh
# Applies db/migrations/*.sql in order, once each, then each installed extension's db/migrations/*.sql
# (recorded as "<id>/<file>"), then (re)applies roles.sql and the per-extension roles.
# Runs in the one-shot `migrate` service as the Postgres superuser, except extension migrations, which
# run as the extension's own owner role (spec 004). Migrations are ADDITIVE only.
# Paths can be overridden for local testing: MIGRATIONS_DIR, ROLES_SQL, EXT_ROLE_SQL, EXTENSIONS_DIR.
set -eu
MIGRATIONS_DIR=${MIGRATIONS_DIR:-/migrations}
ROLES_SQL=${ROLES_SQL:-/roles.sql}
EXT_ROLE_SQL=${EXT_ROLE_SQL:-/extension-role.sql}
EXTENSIONS_DIR=${EXTENSIONS_DIR:-/extensions}
# The shared logs volume is created root-owned; web runs as HOST_UID and must be able to append.
if [ -d /logs ]; then
  chmod 1777 /logs
  # The sticky bit stops web from appending to a web.log that root once created: hand it back.
  if [ -n "${HOST_UID:-}" ]; then touch /logs/web.log && chown "$HOST_UID" /logs/web.log; fi
fi
# The updater-control volume: only web writes it (as HOST_UID).
if [ -d /updater ] && [ -n "${HOST_UID:-}" ]; then chown "$HOST_UID" /updater && chmod 755 /updater; fi
export PGHOST="${PGHOST:-db}" PGUSER="$POSTGRES_USER" PGPASSWORD="${POSTGRES_PASSWORD:-}" PGDATABASE="$POSTGRES_DB"
until pg_isready -q; do sleep 1; done

psql -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA IF NOT EXISTS core;
  CREATE TABLE IF NOT EXISTS core.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

apply() { # $1 = file, $2 = name recorded in core.schema_migrations
  # The name goes into SQL below, and extension repos choose their file names: allow only safe ones.
  case "$2" in
    *[!A-Za-z0-9_./-]* | *..*) echo "[migrate] refusing migration with unsafe name: $2" >&2; exit 1 ;;
  esac
  done_already=$(psql -tAc "SELECT 1 FROM core.schema_migrations WHERE name = '$2'")
  if [ "$done_already" = "1" ]; then return 0; fi
  echo "[migrate] applying $2"
  psql -v ON_ERROR_STOP=1 -q -1 -f "$1" -c "INSERT INTO core.schema_migrations (name) VALUES ('$2')"
}

for f in "$MIGRATIONS_DIR"/*.sql; do
  apply "$f" "$(basename "$f")"
done

# Installed extensions (spec 002): only ids listed in installed.json, only [a-z0-9-] names.
ext_ids=""
if [ -f "$EXTENSIONS_DIR/installed.json" ]; then
  ext_ids=$(grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-z][a-z0-9-]*"' "$EXTENSIONS_DIR/installed.json" | sed -E 's/.*"([a-z0-9-]+)"$/\1/')
fi
# Extension migrations come from other repos, so they never run as the superuser (spec 004). Each
# extension gets an owner role ext_<id>_owner that owns its schema and nothing else. For the run, that
# role gets LOGIN with a random password; the migrations connect AS it, so `RESET ROLE` or
# `SET SESSION AUTHORIZATION` inside a file cannot climb back to the superuser. The runtime role
# ext_<id> (spec 002) only gets DML on the tables, from extension-role.sql below.
ext_owner_prepare() { # $1 = schema name, $2 = owner role
  psql -v ON_ERROR_STOP=1 -q -v s="$1" -v o="$2" <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', :'o') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'o') \gexec
SELECT format('CREATE SCHEMA %I AUTHORIZATION %I', :'s', :'o')
  WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'s') \gexec
-- Schemas created before spec 004 belong to the superuser: hand them and their objects over.
SELECT format('ALTER SCHEMA %I OWNER TO %I', :'s', :'o') \gexec
SELECT format('ALTER TABLE %I.%I OWNER TO %I', n.nspname, c.relname, :'o')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = :'s' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND pg_get_userbyid(c.relowner) <> :'o' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', n.nspname, c.relname, :'o')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = :'s' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> :'o'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) \gexec
SELECT format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, :'o')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = :'s' AND pg_get_userbyid(p.proowner) <> :'o' \gexec
-- What its tables may point at: core.profiles (foreign keys) and nothing else of the shell.
SELECT format('GRANT USAGE ON SCHEMA core TO %I', :'o') \gexec
SELECT format('GRANT SELECT, REFERENCES ON core.profiles TO %I', :'o') \gexec
SQL
}

ext_owner_login() { # $1 = owner role, $2 = password ('' = back to NOLOGIN). Variables, not -c: psql
  # interpolates :'x' only in scripts. The password is random per run and dies with NOLOGIN after it.
  if [ -n "$2" ]; then
    psql -v ON_ERROR_STOP=1 -q -v o="$1" -v pw="$2" <<'SQL'
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'o', :'pw') \gexec
SQL
  else
    psql -v ON_ERROR_STOP=1 -q -v o="$1" <<'SQL'
SELECT format('ALTER ROLE %I NOLOGIN PASSWORD NULL', :'o') \gexec
SQL
  fi
}

for id in $ext_ids; do
  [ -d "$EXTENSIONS_DIR/$id/db/migrations" ] || continue
  schema=$(echo "$id" | tr - _)
  owner="ext_${schema}_owner"
  ext_owner_prepare "$schema" "$owner"
  pending=""
  for f in "$EXTENSIONS_DIR/$id"/db/migrations/*.sql; do
    [ -f "$f" ] || continue
    name="$id/$(basename "$f")"
    case "$name" in
      *[!A-Za-z0-9_./-]* | *..*) echo "[migrate] refusing migration with unsafe name: $name" >&2; exit 1 ;;
    esac
    [ "$(psql -tAc "SELECT 1 FROM core.schema_migrations WHERE name = '$name'")" = "1" ] || pending="$pending $f"
  done
  [ -n "$pending" ] || continue
  pw=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  trap 'ext_owner_login "$owner" ""' EXIT
  ext_owner_login "$owner" "$pw"
  for f in $pending; do
    name="$id/$(basename "$f")"
    echo "[migrate] applying $name as $owner"
    # `CREATE SCHEMA IF NOT EXISTS <own schema>;` needs CREATE on the database even when the schema
    # exists, which the owner role must not have. The schema is already there: drop that one line.
    sed -E "s/^[[:space:]]*CREATE SCHEMA IF NOT EXISTS \"?$schema\"?[[:space:]]*;[[:space:]]*$//I" "$f" |
      PGUSER="$owner" PGPASSWORD="$pw" PGOPTIONS="-c search_path=$schema" psql -v ON_ERROR_STOP=1 -q -1 -f -
    psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO core.schema_migrations (name) VALUES ('$name')"
  done
  ext_owner_login "$owner" ""
  trap - EXIT
done

echo "[migrate] applying roles"
psql -v ON_ERROR_STOP=1 -q \
  -v app_pw="$APP_DB_PASSWORD" -v claude_pw="$CLAUDE_DB_PASSWORD" \
  -f "$ROLES_SQL"

for id in $ext_ids; do
  [ -d "$EXTENSIONS_DIR/$id/db" ] || continue
  schema=$(echo "$id" | tr - _)
  # An extension with background work (manifest "services" or "jobs") also gets a login role for it. Run
  # by the worker (objects: {"name": ..., "run": [...]}), each extension's role has its own password,
  # derived from SERVICES_DB_PASSWORD as docker/worker/worker.py derives it; services still run from the
  # extension's own compose.yml (plain names) log in with SERVICES_DB_PASSWORD itself.
  svc="" svc_pw=""
  manifest=$(tr -d ' \t\r\n' < "$EXTENSIONS_DIR/$id/extension.json" 2>/dev/null)
  case $manifest in
    *'"services":[{'* | *'"jobs":[{'* | *'"services":["'*)
      if [ -z "${SERVICES_DB_PASSWORD:-}" ]; then
        echo "[migrate] $id has services but SERVICES_DB_PASSWORD is not set: no login role for them" >&2
      else
        svc="ext_${schema}_svc"
        case $manifest in
          *'"services":["'*) svc_pw=$SERVICES_DB_PASSWORD ;;
          *) svc_pw=$(printf '%s:%s' "$SERVICES_DB_PASSWORD" "$svc" | sha256sum | cut -d' ' -f1) ;;
        esac
      fi ;;
  esac
  echo "[migrate] role ext_$schema${svc:+ (+ $svc)}"
  psql -v ON_ERROR_STOP=1 -q -v ext_schema="$schema" -v ext_role="ext_$schema" \
    -v svc_role="$svc" -v svc_pw="$svc_pw" -f "$EXT_ROLE_SQL"
done
echo "[migrate] done"
