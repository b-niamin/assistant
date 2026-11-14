# Small helpers the shell scripts share (audit R6-R8): beni.sh and install.sh source it from the checkout,
# migrate.sh from the migrate image (docker/migrate copies it next to itself), backup.sh from its mount.
# POSIX sh, no side effects. scripts/update.sh keeps its own copies on purpose: it runs from the updater's
# home, a single file away from any checkout.

# installed_ids <extensions/installed.json>: the ids it lists, one per line; only [a-z0-9-] names, so a
# value never becomes a path or an option.
installed_ids() {
  [ -f "$1" ] || return 0
  grep -oE '"id"[[:space:]]*:[[:space:]]*"[a-z][a-z0-9-]*"' "$1" | sed -E 's/.*"([a-z0-9-]+)"$/\1/'
}

# purge_ids <extensions/installed.json>: the ids of its "purge" list (`ext remove --data`), one per line,
# minus the installed ones; only [a-z0-9-] names.
purge_ids() (
  [ -f "$1" ] || return 0
  installed=$(installed_ids "$1")
  tr -d '\n\r' < "$1" | grep -oE '"purge"[[:space:]]*:[[:space:]]*\[[^]]*\]' | grep -oE '"[a-z][a-z0-9-]*"' | tr -d '"' |
    while read -r id; do
      [ "$id" = purge ] && continue
      printf '%s\n' "$installed" | grep -qx "$id" || echo "$id"
    done
)

# env_value <file> <NAME>: the last NAME=... line's value of a .env file ('' when there is none).
env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1; }

# iso: now, UTC, as 2026-11-12T20:00:00Z.
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# json_str <text>: a JSON string literal, quotes included; control characters dropped.
json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
