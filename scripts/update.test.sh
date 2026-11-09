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
check 'db/migrations/010_x.sql' ''
check 'specs/006-auto-update.md' ''
check 'docker-compose.yml' 'all'
check 'docker/claude/Dockerfile' 'build:claude'
check 'docker/browser/entrypoint.sh' 'build:browser'
check 'apps/web/scripts/live-reload.mjs' 'restart:web'
check 'services/terminal/server.mjs' ''
check 'services/terminal/server.test.mjs' ''
check 'db/watch-extensions.sh' 'restart:ext-migrate'
check 'db/roles.sql' 'migrate restart:ext-migrate'
check 'db/backup.sh' 'restart:backup'
check "$(printf 'docker/claude/a\ndocker/claude/b\nservices/terminal/ws.mjs')" 'build:claude'
acl=$(printf '%s\n' \
  '-r-xr-xr-x+ 1 1026 100 1520 Nov  6 21:55 /v/apps/web/node_modules/.package-lock.json' \
  '-rw-r--r-- 1 1026 100 10 Nov  6 21:55 /v/apps/web/plain' \
  'dr-xr-xr-x+ 1 1026 100 260 Nov  6 21:55 /v/apps/web/a dir' | sh "$here/update.sh" acl-paths | tr '\n' '|')
[ "$acl" = '/v/apps/web/node_modules/.package-lock.json|/v/apps/web/a dir|' ] || { echo "acl-paths: got '$acl'" >&2; exit 1; }
sh -n "$here/auto-update.sh"
echo "update plan: ok"
