#!/bin/sh
# Migrations of parallel branches must not collide (audit report D11): no two files with the same number,
# and, given the commit a change starts from, every new file sorts after every file that was already there
# (migrate.sh applies them in name order; an older-sorting new file would run out of order on a fresh
# install). Run by CI: sh scripts/check-migrations.sh [<base commit>]
set -eu
dir=db/migrations
dups=$(ls "$dir" | sed -n 's/^\([0-9][0-9]*\)_.*\.sql$/\1/p' | sort | uniq -d)
[ -z "$dups" ] || { echo "check-migrations: two migrations share the number(s): $dups" >&2; exit 1; }
base=${1:-}
if [ -n "$base" ] && git cat-file -e "$base^{commit}" 2>/dev/null; then
  last=$(git ls-tree --name-only "$base" "$dir/" | sed 's#.*/##' | grep '\.sql$' | sort | tail -n 1)
  for f in $(git diff --name-only --diff-filter=A "$base" HEAD -- "$dir" | sed 's#.*/##'); do
    [ "$f" \> "$last" ] || { echo "check-migrations: $f sorts before $last, which main already has: renumber it" >&2; exit 1; }
  done
fi
echo "check-migrations: ok"
