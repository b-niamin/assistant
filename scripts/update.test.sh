#!/bin/sh
# Unit test of `update.sh plan` (which services a change touches) and `acl-paths`. Run by the pre-commit hook.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
check() {
  got=$(printf '%s\n' "$1" | sh "$here/update.sh" plan | tr '\n' ' ' | sed 's/ $//')
  [ "$got" = "$2" ] || { echo "plan '$1': got '$got', want '$2'" >&2; exit 1; }
}
check 'apps/web/src/routes/+page.svelte' ''
check 'extensions/health/manifest.json' ''
check 'db/migrations/002_x.sql' 'build:migrate build:ext-migrate migrate'
check 'specs/006-auto-update.md' ''
check 'docker-compose.yml' 'all'
check 'docker/terminal/Dockerfile' 'build:terminal'
check 'docker/browser/entrypoint.sh' 'build:browser'
check 'docker/worker/worker.py' 'build:worker'
check 'docker/worker/test_worker.py' ''
check 'apps/web/scripts/live-reload.mjs' 'restart:web'
check 'services/terminal/server.mjs' 'restart:terminal'
check 'services/terminal/server.test.mjs' ''
check 'db/watch-extensions.sh' 'build:ext-migrate'
check 'db/roles.sql' 'build:migrate build:ext-migrate migrate'
check "$(printf 'docker/migrate/Dockerfile\ndb/watch-extensions.sh')" 'build:migrate build:ext-migrate migrate'
check 'docker/terminal/beni-guard.test.mjs' ''
check 'db/backup.sh' 'restart:backup'
check 'db/lib.sh' 'build:migrate build:ext-migrate migrate restart:backup'
check "$(printf 'docker/terminal/a\ndocker/terminal/b\nservices/terminal/ws.mjs')" 'build:terminal restart:terminal'
acl=$(printf '%s\n' \
  '-r-xr-xr-x+ 1 1026 100 1520 Nov  6 21:55 /v/apps/web/node_modules/.package-lock.json' \
  '-rw-r--r-- 1 1026 100 10 Nov  6 21:55 /v/apps/web/plain' \
  'dr-xr-xr-x+ 1 1026 100 260 Nov  6 21:55 /v/apps/web/a dir' | sh "$here/update.sh" acl-paths | tr '\n' '|')
[ "$acl" = '/v/apps/web/node_modules/.package-lock.json|/v/apps/web/a dir|' ] || { echo "acl-paths: got '$acl'" >&2; exit 1; }
# The Claude connector: which HTTPS ports of `tailscale funnel status --json` are ours, funnelled, or taken.
fh() { printf '%s' "$1" | sh "$here/update.sh" funnel-has "$2" "$3" 3001; }
J='{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"h.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}},"h.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3001"}}}},"AllowFunnel":{"h.ts.net:8443":true}}'
got="$(fh "$J" ours 8443) $(fh "$J" on 8443) $(fh "$J" used 10000) $(fh "$J" used 443) $(fh "$J" ours 443) $(fh "$J" on 443) $(fh '{}' used 8443)"
[ "$got" = 'yes yes no yes no no no' ] || { echo "funnel-has: got '$got'" >&2; exit 1; }
# COMPOSE_FILE: a compose file gone for good (extension moved to the worker, or removed) leaves the line;
# one missing while its extension still names compose services (mid `ext update`) stays, and blocks pruning.
T=$(mktemp -d)
mkdir -p "$T/extensions/health" "$T/extensions/legacy" "$T/extensions/kept"
printf '{"extensions":[{"id":"health"},{"id":"legacy"},{"id":"kept"}]}' > "$T/extensions/installed.json"
printf '{"id":"health","services":[{"name":"garmin-sync","run":["python"]}]}' > "$T/extensions/health/extension.json"
printf '{"id":"legacy","services": [ "old-sync" ]}' > "$T/extensions/legacy/extension.json"
: > "$T/extensions/kept/compose.yml"; : > "$T/docker-compose.yml"
printf 'A=1\nCOMPOSE_FILE=%s\nB=2\n' "$T/docker-compose.yml:$T/extensions/health/compose.yml:$T/extensions/kept/compose.yml:$T/extensions/gone/compose.yml" > "$T/.env"
chmod 600 "$T/.env"
sh "$here/update.sh" tidy-compose-file "$T" >/dev/null || { echo "tidy-compose-file: failed" >&2; exit 1; }
[ "$(sed -n 's/^COMPOSE_FILE=//p' "$T/.env")" = "$T/docker-compose.yml:$T/extensions/kept/compose.yml" ] &&
  [ "$(sed -n 1p "$T/.env")$(sed -n 3p "$T/.env")" = 'A=1B=2' ] && [ "$(stat -c %a "$T/.env")" = 600 ] ||
  { echo "tidy-compose-file: got $(cat "$T/.env")" >&2; exit 1; }
printf 'COMPOSE_FILE=%s\n' "$T/docker-compose.yml:$T/extensions/legacy/compose.yml" > "$T/.env"
if sh "$here/update.sh" tidy-compose-file "$T" >/dev/null; then echo "tidy-compose-file: a mid-copy file must block pruning" >&2; exit 1; fi
grep -q "legacy/compose.yml" "$T/.env" || { echo "tidy-compose-file: dropped a mid-copy file" >&2; exit 1; }
rm -rf "$T"
echo "update plan, funnel: ok"
