#!/bin/sh
# compose-policy.sh <compose.yml>...: what in an extension's compose.yml could reach the host as root.
# install.sh starts an extension's service (COMPOSE_FILE) only when its file passes. The agents in the
# terminal can write extensions/, and `sudo ./install.sh` brings the file up as root: this check keeps an
# extension's service a plain container (spec 004). Prints one line per problem; exit 1 when there is one.
#
# Refused: privileged, cap_add, devices, the host's network/pid/ipc/userns/cgroup namespaces, security
# options other than no-new-privileges, the Docker socket, `..` in a mount, and host paths except /proc
# and /sys read-only. Relative mounts (./extensions/<id>/...) and named volumes are fine.
set -u
bad=0
for f in "$@"; do
  out=$(sed 's/[[:space:]]#.*$//; /^[[:space:]]*#/d' "$f" | awk -v f="$f" '
    function flag(why) { printf "%s:%d: %s\n", f, NR, why; n++ }
    /^[[:space:]]*privileged:[[:space:]]*['\''"]?(true|yes)/ { flag("privileged") }
    /^[[:space:]]*(cap_add|devices|device_cgroup_rules):/ { flag($1 " is not allowed") }
    /^[[:space:]]*(network_mode|pid|ipc|userns_mode|cgroup):[[:space:]]*['\''"]?host/ { flag("the host namespace: " $0) }
    /security_opt/ { sec = 1 }
    sec && /(unconfined|apparmor|seccomp|label|systempaths)/ { flag("security option: " $0) }
    sec && !/security_opt/ && !/^[[:space:]]*-/ { sec = 0 }
    /docker\.sock/ { flag("the Docker socket") }
    # Short volume syntax: - <source>:<target>[:mode]
    /^[[:space:]]*-[[:space:]]*['\''"]?[^:'\''"]+:[^:]+/ {
      v = $0; sub(/^[[:space:]]*-[[:space:]]*['\''"]?/, "", v); sub(/['\''"][[:space:]]*$/, "", v)
      split(v, p, ":"); src = p[1]
      if (src ~ /\.\./) flag("a mount with ..: " src)
      else if (src ~ /^[\/~$]/) {
        if (!((src == "/proc" || src == "/sys") && p[3] ~ /^ro/)) flag("a host path: " src)
      }
    }
    /^[[:space:]]*source:[[:space:]]*['\''"]?[\/~$]/ { flag("a host path: " $0) }
    /^[[:space:]]*source:.*\.\./ { flag("a mount with ..: " $0) }
    END { exit n > 0 }')
  if [ -n "$out" ]; then printf '%s\n' "$out"; bad=1; fi
done
exit "$bad"
