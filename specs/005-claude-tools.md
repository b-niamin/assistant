# Spec 005: Claude talks to the extensions

## Goal

The owner asks Claude (Remote Control on the host, or `claude` in the in-app terminal) things like "make me a
training plan". Claude answers from whatever the installed apps hold: Garmin data from the health
extension, the gym tracker, later Apple Health or Strava. Extensions only show, store and fetch data; they
do not call AI. The direction is one way: **Claude to the extensions**.

It has to work for every extension, including ones that did not exist when this was written.

## Design

```
Claude Code ──stdio──> scripts/assistant-mcp.mjs ──HTTP, Bearer CLAUDE_TOOLS_TOKEN──> web /api/claude
                         (MCP server "assistant")                                   └─ tools of each extension,
                                                                                       run with ExtensionContext
```

- **`/api/claude`** (web): `GET` lists the extensions a profile sees with their tools; `POST
  {extension, tool, arguments, profile}` runs one. Only a bearer token opens it (`CLAUDE_TOOLS_TOKEN`,
  32+ characters, in the web, llm and terminal containers); browser sessions cannot.
- **`scripts/assistant-mcp.mjs`**: a dependency-free MCP server (stdio). Tool names are
  `<extension>__<tool>`; every tool takes an optional `profile` (default: the main profile). The list is
  read on each `tools/list`, so a new extension appears without a restart. Registered in `.mcp.json`.
- **Tools run as the extension**, through the same `ExtensionContext` as its pages: its DB role
  `ext_<id>`, its scope, its KV, its secrets. Claude cannot reach another extension's tables through a
  tool, and the `secrets` schema stays invisible.

### Generic tools (every extension, no code needed)

| Kind | Tool | What |
|---|---|---|
| native | `describe` | tables and columns of its schema |
| native | `query` | one read-only `SELECT` as role `ext_<id>`, run inside the security-definer function `ext_query.<schema>` (owned by that role, so the query cannot change role), read-only transaction, 15 s timeout, 500 rows; rows come back as JSON objects |
| onefile | `read_data` | everything the app saved (its localStorage), JSON values parsed |
| onefile | `write_data` | set or remove one key; the app reads it back on next open |

Plus `extensions` (from the MCP server): what is installed, scope, tools, profiles.

### Own tools (optional)

A native extension adds tools in `web/tools.server.ts`:

```ts
import type { ExtTool } from '$shell';
export const tools: ExtTool[] = [
  { name: 'overview', description: '...', input: { type: 'object', properties: { days: { type: 'integer' } } },
    run: (args, ctx) => ctx.db((sql) => ...) }
];
```

Use them for a ready-made summary that would take several queries, and for **every write** (validate the
input, write through `ctx.db`). Claude never writes with SQL. Names are `[a-z][a-z0-9_]*`, and an own tool
cannot replace a generic one. The generator adds the file to `generated/tools.server.ts` like the tiles.

Health ships `overview` (latest readings, daily series, recent activities) and `add_journal_entry`.

### Where results go

An answer Claude should keep (a training plan, a shopping list) belongs in an extension: an existing
one through its tools, or a new one built with the `new-extension` skill, so it shows in the app and on
the dashboard.

## Building extensions from Claude Remote

The core installs bare; `ext install <id>` adds a ready-made extension, and Claude builds others with the `add-extension` skill. Whatever the owner points at (a
git repo, an app from onefile-apps, a skeleton in the extensions repo's `inspirations/`, a sentence) is only inspiration: Claude builds
the extension in `extensions/<id>/` of this repo and records the source in `inspiredBy`. No human step:

- `ext-migrate` (compose service) watches `extensions/installed.json` and every migration file and runs
  `db/migrate.sh` within ~15 s of a change (`/logs/ext-migrate.log`).
- the web app rebuilds on its own (`/logs/web.log`).
- its settings panel appears at System settings -> <name> (spec 002).

## Setup

`install.sh` generates `CLAUDE_TOOLS_TOKEN`. Claude Code asks once to approve the project MCP server
`assistant` (or add `"enabledMcpjsonServers": ["assistant"]` to `.claude/settings.json`).
