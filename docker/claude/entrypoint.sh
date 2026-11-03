#!/bin/sh
# Keeps `claude remote-control` running in /workspace. Login state lives in /home/claude (a named
# volume), so it survives container and host restarts. Until you log in, this waits.
set -u
cd /workspace

git config --global --add safe.directory /workspace
git config core.hooksPath scripts/hooks
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # Credential helper reads the token from the environment; it is never written to disk.
  git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'
fi

# The in-app browser (spec 004): expose its CDP on localhost:9222, where Chrome accepts the Host header.
# Used by the `browser` MCP server in .mcp.json.
if command -v socat >/dev/null; then
  socat TCP-LISTEN:9222,fork,reuseaddr,bind=127.0.0.1 TCP:browser:9223 2>/dev/null &
fi

delay=5
while true; do
  if [ ! -s "$HOME/.claude/.credentials.json" ] && [ ! -s "$HOME/.claude.json" ]; then
    echo "[claude] not logged in. Run: docker compose exec -it claude claude   then /login"
    sleep 30
    continue
  fi
  echo "[claude] starting remote-control"
  started=$(date +%s)
  claude remote-control
  # Back off if it keeps dying quickly; reset after a run that lasted a while.
  if [ $(( $(date +%s) - started )) -gt 300 ]; then delay=5; else delay=$(( delay < 300 ? delay * 2 : 300 )); fi
  echo "[claude] remote-control exited; restarting in ${delay}s"
  sleep "$delay"
done
