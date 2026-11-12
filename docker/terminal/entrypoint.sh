#!/bin/sh
# The terminal container's start: prepares the agents' home, then runs the terminal server (spec 004),
# which the web app proxies the dock's shell to. Claude Code and Codex run inside that shell, started by
# hand or by the app ("Update", "Build it", "Install"); nothing runs them in the background.
#
# Login state lives in /home/claude (the agent-home volume), so it survives restarts and rebuilds.
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

# The CLIs run from ~/.npm-global (home volume), where they can update themselves; see cli-home.mjs.
node /usr/local/lib/cli-home.mjs || echo "[cli-home] failed; the image's CLIs run without updates"

# Codex reads MCP servers only from ~/.codex/config.toml: the apps' data and the browser, as .mcp.json has them.
if command -v codex >/dev/null; then
  node /usr/local/lib/codex-config.mjs || echo "[codex] could not write ~/.codex/config.toml"
fi

exec node /workspace/services/terminal/server.mjs
