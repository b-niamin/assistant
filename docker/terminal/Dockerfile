# The in-app terminal (spec 004): a shell with Claude Code, Codex and gh, editing the bind-mounted repo at
# /workspace and reading data through the read-only `claude_ro` role.
FROM node:26-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl postgresql-client python3 python3-venv python3-pip tmux less jq socat procps bubblewrap gh \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code
# Codex (log in through System settings -> Terminal) and the browser driver for the agents.
RUN npm install -g @openai/codex@0.167.0 @playwright/mcp@0.0.84

# Python for extension services' unit tests (offline; their own requirements are not installed here).
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir cryptography "psycopg[binary]" pytest
ENV PATH=/opt/venv/bin:$PATH
# Login shells (`bash -l`, e.g. the terminal after an agent exits) reset PATH in /etc/profile; put ours back.
RUN printf '%s\n' 'PATH="$HOME/.npm-global/bin:/opt/venv/bin:$PATH"' 'export NPM_CONFIG_PREFIX="$HOME/.npm-global"' >/etc/profile.d/beni-path.sh

# What the agents may do without asking: everything, except critical changes, which wait for the owner's
# approval (beni-guard.mjs for Claude Code, beni.rules for Codex; see README.md). Root-owned, so the agents
# cannot loosen them; Claude Code reads managed settings before any of its own.
COPY managed-settings.json /etc/claude-code/managed-settings.json
COPY beni-guard.mjs beni.rules /usr/local/lib/
COPY beni-db /usr/local/bin/beni-db
RUN chmod 644 /etc/claude-code/managed-settings.json /usr/local/lib/beni-guard.mjs /usr/local/lib/beni.rules \
 && chmod 755 /usr/local/bin/beni-db

# Non-root. Match the host owner of the checkout with --build-arg UID=$(id -u) if they differ.
ARG UID=1000
RUN userdel -r node 2>/dev/null || true \
 && useradd -m -u "$UID" -s /bin/bash claude
USER claude
WORKDIR /workspace

# The agents update themselves with `npm install -g`, which /usr/local (root's) does not allow. Global npm
# installs go to ~/.npm-global in the home volume instead; cli-home.mjs copies the image's CLIs there on start.
ENV NPM_CONFIG_PREFIX=/home/claude/.npm-global
ENV PATH=/home/claude/.npm-global/bin:$PATH

COPY --chown=claude entrypoint.sh /usr/local/bin/terminal-entrypoint
COPY --chown=claude codex-config.mjs /usr/local/lib/codex-config.mjs
COPY --chown=claude cli-home.mjs /usr/local/lib/cli-home.mjs
ENTRYPOINT ["sh", "/usr/local/bin/terminal-entrypoint"]
