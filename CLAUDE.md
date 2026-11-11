# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Project skills live in `.ai/skills/`. Claude Code reads `.claude/skills/`, a symlink to
  `../.ai/skills` (Codex and others read `.agents/skills`, the same link).
- `.claude/settings.json` holds Claude Code's deny rules (`.env`, force pushes, `--no-verify`, `docker`).
  In the terminal container, `/etc/claude-code/managed-settings.json` allows the rest and its hook
  `docker/terminal/beni-guard.mjs` asks the owner before critical changes.
