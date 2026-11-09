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

# Both agents run in detached tmux sessions (remote-claude, remote-codex), which these loops watch: Codex
# stops at once without a terminal, and Claude asks "Enable Remote Control? (y/n)" on its first run, which
# nobody answers in a container (it then waits forever and never shows up in claude.ai). This entrypoint
# exists to run Remote Control, so it answers y. Their output goes to ~/.beni/remote/<agent>.log and to
# the container log; `docker compose exec llm tmux attach -t remote-claude` (or remote-codex) shows it live.
remote_in_tmux() {
  name=remote-$1
  shift
  if ! tmux has-session -t "=$name" 2>/dev/null; then
    tmux new-session -d -s "$name" -x 200 -y 50 -c /workspace "sleep 1; exec $*" || return 1
    tmux pipe-pane -o -t "$name" "tee -a $STATE_DIR/${name#remote-}.log >/proc/1/fd/1" 2>/dev/null
  fi
  answered=0
  while tmux has-session -t "=$name" 2>/dev/null; do
    if [ "$answered" = 0 ] && tmux capture-pane -p -t "$name" 2>/dev/null | grep -q 'Enable Remote Control? (y/n)'; then
      tmux send-keys -t "$name" y Enter && answered=1 && echo "[${name#remote-}] answered: Enable Remote Control? y"
    fi
    sleep 5
  done
}
claude_remote() { remote_in_tmux claude claude remote-control; }
# Codex runs as its own daemon (`codex remote-control start`): only then does it have the control socket
# that `codex remote-control pair` (the app's "Pair a device") talks to. It keeps retrying by itself; this
# loop watches its pid and starts it again when it is gone. Its log: ~/.codex/app-server-daemon/daemon.stderr.log.
codex_remote() {
  codex remote-control start >>"$STATE_DIR/codex.log" 2>&1
  pidfile=${CODEX_HOME:-$HOME/.codex}/app-server-daemon/daemon.pid
  sleep 5
  # daemon.pid is JSON: {"pid":258,...}.
  while pid=$(sed -n 's/^{"pid":\([0-9]*\).*/\1/p' "$pidfile" 2>/dev/null) && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; do sleep 10; done
}

: >"$STATE_DIR/claude.log"
if command -v codex >/dev/null; then
  : >"$STATE_DIR/codex.log"
  # A daemon from before this container (its pid file is in the shared home) is not running here.
  codex remote-control stop >/dev/null 2>&1
  supervise codex codex_remote </dev/null &
fi
supervise claude claude_remote
