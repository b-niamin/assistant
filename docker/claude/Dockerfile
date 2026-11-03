# Claude Code workspace container. Edits the bind-mounted repo at /workspace, reads data through the
# read-only `claude_ro` role, and is reachable from claude.ai via Remote Control.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl postgresql-client python3 python3-venv python3-pip tmux less jq socat \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code
# Other agent CLIs (log in through System settings -> Terminal) and the browser driver for Claude.
RUN npm install -g @openai/codex@0.163.0 @playwright/mcp@0.0.83

# Python for extension services' unit tests (offline; their own requirements are not installed here).
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir cryptography "psycopg[binary]" pytest
ENV PATH=/opt/venv/bin:$PATH

# Non-root. Match the host owner of the checkout with --build-arg UID=$(id -u) if they differ.
ARG UID=1000
RUN userdel -r node 2>/dev/null || true \
 && useradd -m -u "$UID" -s /bin/bash claude
USER claude
WORKDIR /workspace

COPY --chown=claude entrypoint.sh /usr/local/bin/claude-entrypoint
ENTRYPOINT ["sh", "/usr/local/bin/claude-entrypoint"]
