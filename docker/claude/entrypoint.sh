#!/bin/sh
# Keeps the agents reachable from outside: `claude remote-control` (claude.ai/code, the Claude app) and,
# once Codex is signed in, `codex remote-control` (the ChatGPT/Codex apps), both in /workspace. Login
# state lives in /home/claude (a named volume), so it survives container and host restarts. Until you
# log in (the terminal bar at the bottom of the app), each one waits.
#
# Each agent's state goes to ~/.beni/remote/<agent>.json ({"state": "...", "since": <epoch>}), which the
# terminal sidecar reads (same volume) for the indicators in the app. A heartbeat touches the files every
# 30 s, so a stopped container shows up as stale instead of "running".
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

STATE_DIR="$HOME/.beni/remote"
mkdir -p "$STATE_DIR"
rm -f "$STATE_DIR"/*.json
# state <agent> <signed-out|starting|running|restarting>
state() {
  printf '{"state":"%s","since":%s}\n' "$2" "$(date +%s)" >"$STATE_DIR/$1.json.tmp" && mv "$STATE_DIR/$1.json.tmp" "$STATE_DIR/$1.json"
}
(while true; do
  for f in "$STATE_DIR"/*.json; do [ -e "$f" ] && touch "$f"; done
  sleep 30
done) &

claude_signed_in() {
  [ -s "$HOME/.claude/.credentials.json" ] || grep -qs '"oauthAccount"' "$HOME/.claude.json"
}
codex_signed_in() {
  [ -s "${CODEX_HOME:-$HOME/.codex}/auth.json" ]
}

# supervise <agent> <command...>: run it while signed in; back off if it keeps dying quickly.
supervise() {
  agent=$1
  shift
  delay=5
  while true; do
    if ! "${agent}_signed_in"; then
      state "$agent" signed-out
      sleep 30
      continue
    fi
    echo "[$agent] starting remote-control"
    state "$agent" starting
    started=$(date +%s)
    # "running" only once it has stayed up for 15 s, so a crash loop never shows as running.
    (sleep 15 && state "$agent" running) &
    watcher=$!
    "$@"
    kill "$watcher" 2>/dev/null
    if [ $(($(date +%s) - started)) -gt 300 ]; then delay=5; else delay=$((delay < 300 ? delay * 2 : 300)); fi
    echo "[$agent] remote-control exited; restarting in ${delay}s"
    state "$agent" restarting
    sleep "$delay"
  done
}

# Codex in the background (no terminal needed), Claude in the foreground with the container's tty.
if command -v codex >/dev/null; then
  supervise codex codex remote-control --no-daemon </dev/null &
fi
supervise claude claude remote-control
