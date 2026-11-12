# Writing an extension: reference

The rules and the reasons are in [spec 002](../specs/002-extensions.md) (extensions), [spec 005](../specs/005-claude-tools.md)
(MCP tools) and [spec 007](../specs/007-languages.md) (languages). This page is the reference: what goes
in the manifest, what the shell gives an extension, and how to try it. Inside a running instance,
`node scripts/ext.mjs new <id>` starts one and `node scripts/ext.mjs check <id>` checks it; the
`new-extension` skill walks through the rest. Working examples: the ready-made extensions in
[b-niamin/assistant-extensions](https://github.com/b-niamin/assistant-extensions/tree/main/extensions)
(`health` and `home` native, `gym` onefile).

`extensions/` is this instance's own folder: git-ignored in this repo, kept by the daily backup
(docs/install.md "Backups"). There is nothing to commit for an extension built here.

## Manifest: `extensions/<id>/extension.json`

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | `[a-z][a-z0-9]*(-[a-z0-9]+)*`, the folder's name, not one of the shell's routes (`api`, `dock`, `mcp`, `settings`, `setup`, ...: `RESERVED_IDS` in `apps/web/scripts/extensions-lib.mjs`) |
| `name` | yes | 1-40 characters |
| `description` | yes | up to 200 characters |
| `version` | yes | semver `x.y.z`; `ext update` compares it |
| `kind` | yes | `native` (Svelte routes compiled into the shell) or `onefile` (one HTML file in a sandbox) |
| `scope` | yes | `profile` (each person their own data) or `shared` (one data set for the home) |
| `shell` | yes | the SDK version the extension needs: `1`, `2` (charts, `EmptyState`, `EN`, ticks) or `3` (`import beni` for services). It only grows, so an extension runs on that core and newer ones |
| `entry` | onefile | the HTML file, e.g. `app.html` |
| `settings` | no | up to 30 fields of its panel in System settings: `name`, `type` (`text`, `number`, `boolean`, `select`, `secret`), `label` (1-60 characters), `default`; `secret` only for native |
| `secrets` | no | native only, up to 10 names; values are set by the owner and read with `ctx.secrets.get` |
| `accessory` | no | what Beni wears on its pages (`beni-accessories.ts`); left out, it is guessed |
| `languages` | no | onefile: the languages its own UI speaks (up to 20) |
| `services`, `jobs` | no | background work the `worker` container runs (spec 002, "Background work"); Python services `import beni` for logging, settings, the database and their loop |

## The `$shell` SDK

Server code imports from `$shell`, components from `$shell/ui`. Nothing else of the shell.

| From | What |
| --- | --- |
| `$shell` | types `ExtensionContext`, `ExtLoad`, `ExtActions`, `ExtHandler`, `ExtTool`, `ExtTile`, `ExtSources`, `DataOf`; `error`, `fail`, `json`, `redirect`; `todayIn(tz?)`, `dayIn(date, tz?)`; since 2: `EN` (English `t` for pure helpers and tests), `niceTicks`, `byteTicks`, `scaledTicks`, `runsOf` |
| `$shell/ui` | `Mascot` (Beni), `countUp`, `useT`, `todayIn`, `dayIn`, `enhance`, `saveOnChoose`; since 2: `LineChart` (series over time with tooltip, arrow keys and a table twin), `Sparkline` (trend glyph), `EmptyState` (Beni + heading + body). Use these before drawing your own (`apps/web/src/lib/sdk/ui.ts`) |

`ExtensionContext` (the `ctx` every load, action, tool and source gets):

| Member | What |
| --- | --- |
| `profileId`, `dataProfileId` | the viewing profile; whose rows to read (`null` for a shared extension). Filter every query by `dataProfileId`. |
| `db(fn)` | one transaction as the extension's role `ext_<id>`: its own schema and `core.profiles`, nothing else |
| `kv` | `all()`, `get(key)`, `set(key, value)`, `remove(key)`: small state in `core.extension_kv`, scoped like the extension |
| `settings` | `all()`, `get(name)`: its panel's plain fields |
| `secrets` | `get(name)`: a declared secret, or `null`; keep it on the server |
| `t`, `lang` | its texts in the page's language (`t('Last night')`, `t.n(n, '{n} run', '{n} runs')`, `t.locale`) |

Days: always `todayIn()` / `dayIn(date)`, never `new Date().toISOString().slice(0, 10)`, which is the UTC
day (yesterday, between midnight and 1-2 a.m. in Poland).

## Files a native extension can have

| File | What |
| --- | --- |
| `web/routes/+page.svelte`, `+page.server.ts` | its page at `/<id>` (`load` is an `ExtLoad`, actions are `ExtActions`) |
| `web/routes/settings/` | an extra view at `/<id>/settings`, linked from its panel |
| `web/tools.server.ts` | its MCP tools (below); required |
| `web/tiles.server.ts` | dashboard tiles (`ExtTile`, spec 003) |
| `web/sources.server.ts` | "Connected accounts" in its panel (`ExtSources`: `list(ctx)` returns up to 8 sources with state `connected`, `not_connected`, `reconnect` or `planned`; `act(ctx, source, action, input)` runs one of their actions) |
| `db/migrations/*.sql` | its schema `<id>`, additive only; applied by `ext-migrate` within about 15 s, as `ext_<id>_owner` |
| `i18n/<lang>.json` | its texts in every language of the app (spec 007) |
| `AGENTS.md` | its tables and conventions, for the AI that changes it |

A onefile extension is `extension.json`, its HTML, `i18n/` and `web/tools.server.ts`. The shell injects a
`localStorage` that saves to the server, the shell's tokens, `<assistant-beni>`, `window.assistantSettings`
and `window.assistantLang`. A tile comes from the `__tile` key it writes (spec 003).

## Look

Use the tokens and classes of `apps/web/src/app.css` (spec 001), never raw colours or sizes:

| Kind | Names |
| --- | --- |
| Colours | `--page`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3` (secondary text), `--ink-4` (non-text marks), `--accent`, `--accent-ink` (links), `--accent-fill` (filled buttons), `--field-border`, `--good`, `--warning`, `--serious`, `--critical`, `--critical-ink` (error text), `--hue-*` (chart series) |
| Space and shape | `--space-1` to `--space-7`, `--radius`, `--radius-sm`, `--font`, `--mono` |
| Classes | `.card`, `.btn`, `.btn-primary` (one per screen), `.btn-ghost`, `.eyebrow`, `.muted`, `.num` (tabular figures), `.segmented`, `.status` + `good`/`warning`/`serious`/`critical` (a dot and a word, never colour alone), `.sr` (screen readers only), `.rise` (entrance) |

## MCP tools: `web/tools.server.ts`

```ts
import type { ExtTool } from '$shell';
export const tools: ExtTool[] = [
  { name: 'overview', title: 'Training overview', readOnly: true, description: '...', run: (args, ctx) => ... },
  { name: 'log_workout', title: 'Log a workout', readOnly: false, description: '...',
    input: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] },
    run: (args, ctx) => { /* validate args, then write through ctx.db or ctx.kv */ } }
];
```

- `name`: `[a-z][a-z0-9_]{0,39}`, called as `<id>__<name>`. An `overview` with `readOnly: true` is required.
- `title` up to 80 characters, `description` up to 2000 (longer is cut).
- `readOnly`: say it on every tool (`ext check` warns otherwise); left out it counts as a write.
  `destructive: true` marks a write that removes or replaces data.
- `profile` is reserved: the shell adds it for the terminal and strips it before `run`; use
  `ctx.dataProfileId`. Claude connector connections never get it (they act for their own profile).
- The shell checks the arguments against `input` before `run` (type, enum, required, minimum/maximum,
  lengths, items, pattern, oneOf/anyOf) and answers a wrong call with every wrong field, so `run` only
  checks business rules. Throw `ToolError` from `$shell` for a call that is wrong in a way the schema
  cannot say.
- What `run` returns goes back as JSON text and as `structuredContent`; a thrown error comes back as a
  tool error (`isError`) with its message.
- The shell adds raw tools: `describe` and `query` (read-only SQL) for native, `read_data` and
  `write_data` for onefile. They are for the terminal only; the Claude connector never sees them, so the
  extension's own tools must cover what Claude needs.

Calling a tool by hand, in the terminal:

```sh
curl -s http://web:3000/mcp -H "authorization: Bearer $CLAUDE_TOOLS_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gym__overview","arguments":{}}}'
```

`"method":"tools/list"` lists them.
