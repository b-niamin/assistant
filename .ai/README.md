# .ai

Agent skills for this repo, one folder each, shared by every agent:

| Skill | Use it for |
|---|---|
| [add-extension](skills/add-extension/SKILL.md) | adding an app: install a ready-made one, or build one from an idea or an inspiration |
| [new-extension](skills/new-extension/SKILL.md) | how to build or change an extension (kinds, scope, settings, tools, checks) |

## Agent folders

Agents look for skills in different places. They all point here:

- `.claude/skills` → `../.ai/skills` (Claude Code)
- `.agents/skills` → `../.ai/skills` (Codex, Cursor, Gemini CLI and others that read `.agents/`)

The links are committed as symlinks. Rules for every agent are in [AGENTS.md](../AGENTS.md);
[CLAUDE.md](../CLAUDE.md) only imports it and adds Claude Code specifics.
