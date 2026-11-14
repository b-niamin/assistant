# Spec 005: the AI talks to the extensions (MCP)

## Goal

The owner asks Claude things like "make me a training plan" from wherever they are: claude.ai, the
Claude apps on a phone or computer, or Claude Code and Codex in the app's own terminal. Claude answers
from whatever the installed apps hold (training data, the gym log, the house) and keeps results in them.
Extensions only show, store and fetch data; they never call an AI. The direction is one way: **the AI to
the extensions**.

It has to work for every extension, including ones that did not exist when this was written.

## Design

One MCP server, served by the web app at `/mcp`, with two ways in:

```
claude.ai, Claude apps ──HTTPS──> Tailscale Funnel :443 ───> web, public listener :3001 ──┐
  (the Claude connector, OAuth)                              (only /mcp, /mcp/oauth/*,   │
                                                              2 discovery files)        ├─> /mcp ─> each extension's
terminal: Claude Code, Codex ──stdio──> scripts/assistant-mcp.mjs ──Bearer CLAUDE_TOOLS_TOKEN──┘        tools, run with
  (.mcp.json, ~/.codex/config.toml)       (relays JSON-RPC lines)                                    ExtensionContext
```

- **`/mcp` and the profiles' MCP addresses `/mcp/x/<id>`** (`lib/mcp/handler.server.ts`): MCP over Streamable HTTP without sessions or
  server-sent events: POST one JSON-RPC message or a batch, get one JSON answer (202 for notifications).
  GET and DELETE answer 405, or 401 (with the sign-in metadata) without a token. Every public path but the
  authorize page answers CORS (`Access-Control-Allow-Origin: *`, preflight 204): claude.ai checks the
  address from the browser before it signs in.
  Tools: `extensions` (the apps, their scope and tools, the profiles) and `<extension>__<tool>` for every
  tool of every extension the caller may see. The list is read on each `tools/list`, so a new extension
  appears on the server without a restart (claude.ai reads the list when it connects: reconnect there).
- **Tools run as the extension**, through the same `ExtensionContext` as its pages: its DB role
  `ext_<id>`, its scope, its KV, its secrets. A tool cannot reach another extension's tables, and the
  `secrets` schema stays invisible.
- **Two kinds of bearer token**:
  - `CLAUDE_TOOLS_TOKEN` (32+ characters, `.env`, in the web and terminal containers) for the CLIs in the
    terminal: every tool, the default profile unless a call passes `profile`. Refused on the public
    listener: it never leaves the stack.
  - OAuth access tokens of the Claude connector (`lib/mcp/backend.server.ts`): only the profile, apps and
    writes of the MCP address its connection was approved on (below). On `/mcp/x/<id>` only that
    address's connections get in. No `profile` argument (naming another profile is refused), no
    raw tools (`query`, `describe`, `read_data`, `write_data`: those hand out every profile's rows or the
    raw saved data), and tools with `readOnly: false` only with the `mcp:write` scope.
- **Audit**: every `tools/call` adds a row to `core.tool_calls` (time, terminal or connection, profile,
  tool, ok or the error, duration; never arguments or results), shown on the settings page; 90 days kept.

## The extension tools contract

Every extension adds its tools to the MCP server the same way, native and onefile alike:

```
extensions/<id>/web/tools.server.ts      export const tools: ExtTool[]
```

```ts
import type { ExtTool } from '$shell';
export const tools: ExtTool[] = [
  { name: 'overview', title: 'Training overview', readOnly: true,
    description: 'Latest reading of every metric, the daily series of the last `days` days, recent activities.',
    input: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } },
    run: (args, ctx) => ctx.db((sql) => ...) },
  { name: 'add_journal_entry', title: 'Save how a day felt', readOnly: false,
    description: '...', input: { ... , required: ['day'] },
    run: (args, ctx) => { /* validate, then write through ctx.db or ctx.kv */ } }
];
```

| Field | Rule |
|---|---|
| `name` | `[a-z][a-z0-9_]*`, up to 40 characters, unique in the extension; cannot replace a generic tool. The AI sees `<id>__<name>`. |
| `title` | A short human name; clients show it when they ask to allow the tool. |
| `description` | For the AI: what it does, what it returns, what the arguments mean. |
| `input` | A JSON Schema object (`type: 'object'`). |
| `readOnly` | `true` for reads (clients may run them without asking), `false` for every write. Required. |
| `destructive` | `true` when a write deletes or overwrites what the owner made, not just adds to it. |
| `run(args, ctx)` | Validates `args` itself; throws an `Error` whose message goes back to the AI. |

Required of every extension (`node scripts/ext.mjs check` warns otherwise):

1. A read-only **`overview`**: one call that sums up what the app holds now, in plain fields (values
   already extracted, dates as ISO strings), so the AI rarely needs SQL.
2. **One tool per write**, validated like the page's form. The AI never writes with SQL, and onefile
   apps' writes keep the app's data format, since the app reads it back on the next open.
3. `readOnly` on every tool.

The generator lists every `web/tools.server.ts` in `generated/tools.server.ts`, like the tiles. For a
onefile app, `ctx.kv` is its localStorage as the shell saves it.

### Generic tools (every extension, no code needed)

| Kind | Tool | What |
|---|---|---|
| native | `describe` | tables and columns of its schema |
| native | `query` | one read-only `SELECT` as role `ext_<id>`, run inside the security-definer function `ext_query.<schema>` (owned by that role, so the query cannot change role), read-only transaction, 15 s timeout, 500 rows; rows come back as JSON objects |
| onefile | `read_data` | everything the app saved (its localStorage), JSON values parsed |
| onefile | `write_data` | set or remove one key (destructive) |

### Where results go

An answer the owner should keep (a training plan, a shopping list) belongs in an extension: an existing
one through its tools, or a new one built with the `new-extension` skill, so it shows in the app and on
the dashboard.

## The Claude connector (claude.ai and the Claude apps)

claude.ai calls MCP servers from Anthropic's cloud, so a tailnet address is not enough: the MCP server
must be reachable over public HTTPS. The rest of the app must not be.

- **Public listener** (`apps/web/server.mjs`): a second HTTP server on `MCP_PORT` (container 3001, host
  `127.0.0.1:${MCP_PORT:-3101}`). It answers only `/mcp`, `/mcp/oauth/*`,
  `/.well-known/oauth-protected-resource[/mcp]` and `/.well-known/oauth-authorization-server`
  (`lib/mcp/paths.js`); everything else is 404, WebSocket upgrades too. It marks its requests
  (`x-beni-public`, stripped on the main listener), and `hooks.server.ts` refuses any other path from it.
- **Tailscale Funnel** publishes that listener at `https://<machine>.<tailnet>.ts.net` (port 443: claude.ai's
  servers connect to no other port). The app's own address stays tailnet-only (Tailscale Serve), on another
  port (install.sh suggests 8443). When 443 only repeats the app (Serve to WEB_PORT, PUBLIC_ORIGIN on another
  port) the updater takes it over; anything else on 443 is reported, not touched. A funnel of ours on 8443
  or 10000 (older versions) moves to 443.
- **The switch** is System settings -> MCP on the internet (`/settings/connector`), once for the server. It writes `funnel=on|off`
  to `/updater/control` (a volume only web mounts, spec 006); the host's updater (spec 006, runs every minute as root) applies it with
  `tailscale funnel --bg --https=443 http://127.0.0.1:<MCP_PORT>` (or `... off`) and reports the state,
  port and URL in `/logs/funnel-status.json`. No container gets the Tailscale socket. On the host,
  `sudo sh <home>/update.sh funnel` applies it at once.
- **One manual step**: Tailscale has to allow Funnel for the machine once (the `funnel` node attribute in
  the tailnet policy file). Until then `tailscale funnel` prints a link to enable it; the settings page
  shows that link.
- **OAuth 2.1** (`lib/mcp/oauth*.ts`), what MCP clients expect:
  - discovery: `/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=...`; the metadata
    documents (RFC 9728, RFC 8414) put every endpoint under `/mcp/oauth/`. The issuer is the address the
    client used (only the public host name is believed from `Host`).
  - dynamic client registration (`/mcp/oauth/register`, RFC 7591), rate-limited, at most 200 clients.
    Redirect URIs: https on claude.ai or claude.com (plus the hosts in `MCP_REDIRECT_HOSTS`), or http on
    the loopback. Anything else could collect a code the owner approved for "Claude".
  - `/mcp/oauth/authorize`: a self-contained page (no app scripts or styles, which the
    public listener does not serve) that asks for nothing. It files a request in `core.oauth_requests`
    (with the address the client names in `resource`, RFC 8707), sets a cookie tying it to this browser,
    and shows the client's name, return host and a code such as `KQPT-WMRA`, refreshing itself. The owner
    approves the request in the app on the tailnet (MCP connector, `/settings/mcp`) by picking one of
    the profile's addresses. The page then sends the browser back with a single-use code (or
    `access_denied`). The app password never crosses the Funnel, so there
    is nothing to guess and no shared rate limit to lock the owner out. Requests end after 10 minutes, at
    most 20 wait at once. PKCE S256 is required.
  - `/mcp/oauth/token`: `authorization_code` and `refresh_token`. Access tokens last 1 hour, refresh
    tokens 90 days and rotate on every use; a code or refresh token used twice removes the whole
    connection. A connection ends 180 days after its approval, whatever the refresh tokens say.
    `/mcp/oauth/revoke` (RFC 7009).
  - Only SHA-256 hashes of codes and tokens are stored (`core.oauth_tokens`); `claude_ro` cannot read the
    OAuth tables.
- **MCP addresses** (`core.mcp_endpoints`, `lib/mcp/endpoints.server.ts`, each profile's MCP connector,
  `/settings/mcp`): each profile has a built-in address with every app and writes allowed
  ("All apps", cannot be removed), and its own ones: a name, the apps ticked, may change data or not. The
  address to paste into Claude is `<Funnel URL>/mcp/x/<id>`. A connection follows its address: a change
  of ticks applies at its next call, removing the address removes its connections. The scope a token
  reports is `mcp:read` or `mcp:read mcp:write` from the address.
- **Connections**: each approval is a row in `core.oauth_grants` (profile, address, end), listed and
  removable in the profile's MCP connector, with its latest tool calls (each profile sees only its own).
  Removing a profile removes its addresses and connections. Turning the
  connector off removes them all, and every waiting request.
- **CSRF**: SvelteKit refuses form posts whose Origin is not `ORIGIN`. `server.mjs` sets it for the token,
  register and revoke endpoints (no cookies there). The authorize page takes no posts.

### Adding it to Claude

1. Once for the server: System settings -> MCP on the internet -> Turn on.
2. claude.ai -> Settings -> Connectors -> Add custom connector: a name and an address from the
   profile's MCP connector ("All apps", or one of the profile's own).
3. Connect: a page with a code opens. In the app (on the tailnet), MCP connector
   shows the same code under "Waiting for approval": pick the address and Approve. The page in Claude
   moves on by itself.
4. Turn the connector on in a chat's tools menu. The Claude apps get it from the account.

## The CLIs in the terminal

`.mcp.json` registers `assistant` (stdio, `scripts/assistant-mcp.mjs`) for Claude Code; the terminal
container's entrypoint writes the same server into `~/.codex/config.toml` for Codex. The relay sends each
JSON-RPC line to `http://web:3000/mcp` with `CLAUDE_TOOLS_TOKEN`. Claude Code asks once to approve the
project MCP server (or add `"enabledMcpjsonServers": ["assistant"]` to `.claude/settings.json`).

## Building extensions with the AI

The core installs bare; `ext install <id>` adds a ready-made extension, and the AI in the terminal builds
others with the `add-extension` skill (System settings -> Extend the system starts it). Whatever the owner
points at (a git repo, an app from onefile-apps, a ready-made extension to learn from, a
sentence) is only inspiration: the extension is built in `extensions/<id>/` and the source is recorded in
`inspiredBy`. No human step:

- `ext-migrate` (compose service) watches `extensions/installed.json` and every migration file and runs
  `db/migrate.sh` within ~15 s of a change (`/logs/ext-migrate.log`).
- the web app rebuilds on its own (`/logs/web.log`), and its tools appear in `tools/list`.
- its settings panel appears at System settings -> <name> (spec 002).
