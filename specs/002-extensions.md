# Spec 002: Core shell and installable extensions

Status: **Built** (extensions come from the extensions repo or are built by Claude; sources are inspiration)

## Goal

A small **core shell** with **extensions** (apps), like a phone:

- The shell owns what every app needs: the stack (Docker Compose on the host), Claude with Remote Control,
  the app password, profiles, the database, the layout and navigation, the dashboard, and **System
  settings**, where every extension has its own panel (like the iOS Settings app).
- An extension is one area: Training & Health, the gym tracker, later Home Assistant, a calendar,
  learning, Strava, ... They live side by side and do not call each other. Claude talks to each of them
  (spec 005) and combines them, e.g. a training plan from health data and the gym log.
- **Ready-made extensions** come from the extensions repo
  ([assistant-extensions](https://github.com/b-niamin/assistant-extensions)): `ext install <id>`.
- **Claude Remote builds the rest.** The owner points it at something (their repo, someone
  else's repo, an app from [onefile-apps](https://github.com/b-niamin/onefile-apps), a link, an idea):
  that is inspiration only. Claude writes the extension in `extensions/<id>/`, adapted to this instance.
- Some extensions keep data per profile (health, learning), some share one data set (Home Assistant, a
  family calendar).

## Research: how others do it

| System | Unit of extension | Loading | Isolation | Data | What we take |
|---|---|---|---|---|---|
| VS Code | package + `package.json` manifest with *contribution points* | runtime, lazy (activation events) | separate extension host process | own storage API (global / workspace) | declarative manifest; a small, versioned API surface; scoped storage |
| Grafana | plugin (`plugin.json`): app, panel, datasource; optional backend binary | frontend loaded at runtime; backend as a separate process over gRPC | backend process boundary; frontend trusted | via datasources | **kinds** of extension with different powers; services as separate processes |
| Backstage | npm package per plugin | **static**: composed at build time (dynamic plugins via module federation came later and are complex) | none (trusted code) | each plugin owns its DB tables / migrations | build-time composition is the simple, type-safe default for a single trusted owner |
| Home Assistant + HACS | integration folder with `manifest.json`, installed from a **git repo** | Python import at startup; restart to load | none (trusted) | config entries; own storage | install from a git URL, pin a version, restart to apply |
| Nextcloud | app (`info.xml`) from an app store | runtime (PHP) | none | own DB tables via migrations; per-user and app-wide settings | per-app migrations; **per-user vs app-wide** data |
| Obsidian | `manifest.json` + `main.js`, community list of GitHub repos | runtime | none | `data.json` per plugin | dead-simple packaging from a GitHub release |
| Umbrel / CasaOS | an app = a `docker-compose.yml` + metadata | `docker compose up` | containers | volumes | background services are compose fragments, applied by a human/host step |
| Browser sandboxed iframes (Figma plugins, claude.ai artifacts) | one HTML/JS bundle | runtime, no build | iframe sandbox + CSP, `postMessage` bridge | host-provided storage | **untrusted or throwaway UI runs in a sandbox with a storage bridge** |

Takeaways for a single-owner self-hosted app that Claude edits live:

1. **Build-time composition** (Backstage, HACS "restart to load") fits best. We already rebuild the web
   app on every commit with a safe swap (`scripts/live-reload.mjs`): installing an extension is just one
   more change that triggers a build, and a broken extension fails the build instead of the running app.
   Runtime module loading (module federation, `import()` of remote code) adds a lot of moving parts for
   no gain here.
2. **Two kinds** (Grafana-style), because the powers differ:
   - **native**: SvelteKit routes compiled into the shell, server code with DB access. Trusted code.
   - **onefile**: one self-contained HTML file run in a sandboxed iframe, with storage provided by the
     shell. Cannot reach anything. This is exactly what onefile-apps already produces.
3. **Manifests + a small versioned SDK** (VS Code): extensions import only `$shell`, never shell
   internals, so the shell can change underneath them.
4. **Each extension owns its schema and migrations** (Nextcloud, Backstage), applied by the shell.
5. **Background services are compose fragments** (Umbrel), applied by a human, like every compose change
   today.
6. **Install from git, pin the commit** (HACS), so an instance can be rebuilt reproducibly.

## Design

### Two repos

```
assistant                           the shell (this repo)
  extensions/                       git-ignored: this instance's installed extensions
    installed.json                  which extensions are on, nav order, default visibility, origin
    <id>/                           one extension, copied from the extensions repo or built here

assistant-extensions                ready-made extensions and reference skeletons
  extensions/<id>/                  ready to install as they are (health, gym, ...)
  inspirations/<name>/              skeletons Claude starts new extensions from (not installable)
```

`ext install <id>` shallow-clones the extensions repo (`EXTENSIONS_REPO`), copies `extensions/<id>/` into
`extensions/<id>/` and records the source commit as `from`; `ext update <id>` replaces it with the repo's
current version (the old folder goes to `extensions/.trash/`). Nothing is fetched at runtime.
For anything else, a source the owner names is read in a scratch directory and only inspires the code
Claude writes in `extensions/<id>/` (the `add-extension` skill); its link is recorded as `inspiredBy`.
Claude edits an extension in place (live-reload rebuilds the shell). An extension worth sharing between
instances is copied into the extensions repo by hand.

### Manifest: `extensions/<id>/extension.json`

```jsonc
{
  "id": "health",                 // = folder name = URL (/health) = DB schema (health) = role ext_health
  "name": "Training & Health",
  "description": "Garmin: sleep, HRV, Body Battery, readiness, activities",
  "version": "0.2.0",
  "kind": "native",               // native | onefile
  "scope": "profile",             // profile | shared
  "shell": 1,                     // SDK contract version this extension was written for
  "entry": "app.html",            // onefile only
  "accessory": "stethoscope",     // optional: what Beni wears on its pages (specs/001-design.md); else guessed
  "languages": ["en", "pl"],      // onefile only: the languages its own UI speaks (spec 007)
  "settings": [                   // optional: its panel in System settings (see "Settings")
    { "name": "units", "label": "Units", "type": "select", "options": ["km", "mi"], "default": "km" }
  ],
  "schema": "health",             // informational; the schema is always the id with - -> _
  "services": ["garmin-sync"]     // background services in its compose.yml; see "Services"
}
```

Ids are `[a-z][a-z0-9-]*` and may not take a path the shell owns (`login`, `api`, `profile`, ...).

Next to the manifest, `i18n/<lang>.json` holds its texts in another language (English text ->
translation); every extension ships one for each language of the app. See spec 007.

### `extensions/installed.json`

```json
{ "extensions": [
  { "id": "health" },
  { "id": "gym", "from": "https://github.com/b-niamin/assistant-extensions/tree/<commit>/gym" },
  { "id": "home", "profiles": ["alex", "sam"], "inspiredBy": "https://github.com/<someone>/<repo>" }
]}
```

Order = nav order. `profiles` is who sees it by default (System settings can override); absent =
everybody. `from` is where `ext install` took it from, `inspiredBy` a link or a note. Every listed id must have a
folder. A missing `installed.json` means no extensions.

### Native extensions

```
extensions/<id>/
  extension.json  README.md  AGENTS.md (CLAUDE.md: `@AGENTS.md`)
  web/routes/**        SvelteKit route files (+page.svelte, +page.server.ts, +server.ts, +layout.*, +error.svelte)
  web/lib/**           components, helpers, unit tests (*.test.ts run with the shell's vitest)
  db/migrations/*.sql  additive SQL for schema <id>
```

**Loading.** `npm run gen` (runs before every build, dev and check) reads `installed.json`, validates
each manifest and generates thin stubs in `apps/web/src/routes/(extensions)/<id>/…` that import the
extension's files through the `$extensions` alias. Server stubs wrap `load`, `actions` and handlers so
that they receive a second argument, the **context**:

```ts
export const load = (async ({ url }, ctx) => {
  return ctx.db((sql) => sql`SELECT … FROM health.synced_activities WHERE profile_id = ${ctx.dataProfileId}`);
}) satisfies ExtLoad;
```

- `ctx.profileId`: who is looking. `ctx.dataProfileId`: whose data (= profileId for scope `profile`,
  `null` for scope `shared`).
- `ctx.db(fn)`: one transaction that first runs `SET LOCAL ROLE ext_<id>`. That role can use only the
  extension's own schema and read `core.profiles`, so a bug in one extension cannot touch another's tables.
  (Native extensions run in the shell's process, so this is a guard against mistakes, not a security
  boundary against hostile code. Untrusted code belongs in a onefile extension.)
- `ctx.kv`: small key-value storage scoped like the extension (`core.extension_kv`), e.g. settings.

**The SDK** is `$shell` (types, context, `fail`/`error`/`redirect`/`json`) and `$shell/ui` (Beni the mascot,
motion helpers). The CSS tokens from `app.css` and `specs/001-design.md` are global. `ext check` rejects an
import of anything else from the shell (`$lib` or `#lib`, another extension's files). The contract version is
`SHELL_API` (now 1); a manifest with another `shell` value does not build.

**Look (required).** Every extension wears the shell's layout and has Beni, the mascot, woven in: native
pages through the global tokens and `$shell/ui`, onefile apps through the tokens and `<assistant-beni>`
that the host injects into their iframe. Details and the `look:` warnings of `ext check`: spec 001,
"Extensions wear this look".

**Safety.** Generation and the build fail on any invalid manifest or missing bundled extension, and
live-reload keeps the previous build serving. Generated files are rewritten only when their content
changes, and live-reload ignores them, so a build never triggers itself.

### Onefile extensions

```
extensions/<id>/
  extension.json  (kind "onefile", entry "app.html")
  app.html        one self-contained HTML file, by the onefile-apps rules
```

The shell route `/<id>` renders an iframe of `/api/onefile/<id>`:

- The iframe is sandboxed **without** `allow-same-origin`, and the response carries a CSP with `sandbox`
  and `connect-src 'none'`. The app gets an opaque origin: it cannot read the shell's cookies, call its
  API, touch the parent page, or reach the network.
- Before serving, the shell injects a `localStorage` shim pre-filled with the extension's stored data.
  Writes go to the parent page by `postMessage` (to the shell's origin only); the parent checks the
  sender is its own iframe, batches writes and saves them to `core.extension_kv` via `PATCH /api/kv/<id>`
  (same-origin only, 5 MB per value, 20 MB per extension and owner). `sessionStorage` is an in-memory shim.
- The same HTML still works on its own with real localStorage, so apps can move both ways between this
  shell and onefile-apps (and claude.ai artifacts).

The gym tracker in the extensions repo is a copy of an app from onefile-apps, so it can be changed freely. `ext new <id> --from onefile:<appType>/<variant>` starts a new one the same way.

### Data scope: per profile vs shared

| | scope `profile` | scope `shared` |
|---|---|---|
| native tables | `profile_id` column → `core.profiles` (cascade), every query filters by `ctx.dataProfileId` | no `profile_id`; one data set |
| onefile / `ctx.kv` | rows with `profile_id` = viewing profile | rows with `profile_id IS NULL` |
| e.g. | health, learning, gym | Home Assistant dashboard, family calendar |

Visibility is separate from scope: `profiles` in `installed.json` decides who sees an extension at all.

### Database

- `db/migrate.sh` applies the shell's `db/migrations/*.sql`, then for every id in `installed.json` its
  `db/migrations/*.sql`, recorded as `<id>/<file>` in `core.schema_migrations`. Same rules as now:
  additive only, applied on `docker compose up` (a human step).
- Then it applies `roles.sql` and, per extension with a `db/` folder, `db/extension-role.sql`: role
  `ext_<id>` (NOLOGIN) with rights on schema `<id>` and `SELECT` on `core.profiles`, granted to `app_rw`;
  `claude_ro` can read the schema for data chat.
- Extension secrets (e.g. a Home Assistant token) must not go in `core.extension_kv`, which `claude_ro`
  can read. Next step: `secrets.extension_secrets`, written from a shell settings page, exposed as
  `ctx.secrets`, invisible to `claude_ro`.
- Tables an extension names `secret_*` (e.g. health's encrypted Garmin logins) are revoked from
  `ext_<id>`, `app_rw` and `claude_ro`: only the extension's service role reads them.

### Services (background work)

Some extensions need a process: health has `garmin-sync`, a Home Assistant extension may want a poller.
An extension ships `compose.yml` at its root, a compose fragment using only the stack's network, the
`logs` volume and its own DB login, with paths relative to the checkout
(`./extensions/<id>/services/...`). Its manifest lists the services (`"services": [...]`), which makes
`db/migrate.sh` create a login role `ext_<id>_svc` (password `SERVICES_DB_PASSWORD`, member of `ext_<id>`,
plus its `secret_*` tables). `install.sh` writes `COMPOSE_FILE=docker-compose.yml:extensions/<id>/compose.yml:...`
into `.env` from the installed extensions and starts them; so after `ext install` of an extension with a
service, the owner runs `./install.sh` once on the host (no container has the Docker socket).

### Claude building extensions

Two project skills: `add-extension` (the configurator: understand the ask, read the source as
inspiration, build, settings panel, tools, check, commit) and `new-extension` (how to build one):

1. Pick the kind: **onefile** for a UI-only tool whose data can live in the browser-style store
   (flashcards, a habit tracker, a checklist); **native** when it needs SQL, server-side calls (Home
   Assistant, calendars), data from another source, or sharing across profiles with real queries.
2. Start from something: `ext new <id> --kind native|onefile --scope profile|shared`,
   `--from onefile:<appType>/<variant>` (an app in onefile-apps) or `--from inspiration:<name>`
   (`inspirations/<name>` in the extensions repo), with `--inspired-by <link>`. A ready-made extension is
   just `ext install <id>`. The `add-extension` skill is the full procedure.
3. Translate it into every language of the app (spec 007): `ext check <id>` lists the gaps as `i18n:`
   warnings, also right after `ext install`.
4. Build, check (`ext check <id>`, `npm test && npm run check`, `build ok` in `/logs/web.log`), and tell
   the owner what to fill in its panel. Migrations apply by themselves (`ext-migrate`); only a new
   background service needs `./install.sh` on the host.

### CLI

`node scripts/ext.mjs available | install | update | list | check [id] | languages | new | profiles | remove` (see the header of `scripts/ext.mjs`). `remove` moves the folder to `extensions/.trash/` and never drops data.

### System settings (`/settings`): one place for all settings

Like the iOS Settings app: a list of the extensions, each opening its own panel, and a System part. All
of it sits behind a step-up: the app password is asked again and the session stays elevated for
10 minutes (`core.sessions.elevated_until`); every action checks it server-side.

**An extension's panel** (`/settings/extensions/<id>`):
- **Availability**: on/off (hidden everywhere, data kept) and which profiles see it
  (`core.extension_settings`, over the defaults in `installed.json`). Hidden extensions answer 404,
  also on their `/api/*` routes and to Claude's tools.
- **Settings**: the fields its manifest declares in `"settings"`: `text`, `number`, `boolean`, `select`
  (`options`), each with `label` and optional `help`/`default`. Values in `core.extension_config`, one set
  per extension. Native code reads `ctx.settings.get(name)`; a onefile app gets them as
  `window.assistantSettings` (read-only).
- **Secrets**: fields of type `secret` (tokens, passwords), encrypted with `SECRETS_KEY` in
  `secrets.extension_secrets`, write-only in the UI, read by native code with `ctx.secrets.get(name)`
  (spec 004). The older manifest list `"secrets": ["token"]` still works and shows up here.
- **More**: an extension that needs more than fields ships `web/routes/settings/+page.svelte`; its panel
  links to that view (`/<id>/settings`).
- **Connected accounts**: an extension that pulls data from outside accounts (Garmin, Strava, ...) ships
  `web/sources.server.ts` exporting `sources: ExtSources` (`$shell`): `list(ctx)` describes each account as
  data (state, which account, how to connect, a few facts, the sync state with a 0..1 progress) and
  `act(ctx, source, action, input)` runs an action it offers ("Sync now", "Fetch older data" with a date).
  The shell renders them at the top of the panel, clamps what comes back (`lib/extensions/sources.ts`),
  checks an action is on offer before running it and polls `/settings/extensions/<id>/sources` every few
  seconds while a sync is queued or running. Logins are never typed into the web app: `command` names
  the terminal command that connects an account. The extension's background service does the fetching;
  an action only queues work for it (health: `health.sync_requests`).
  A source reached with an address and an API token (Home Assistant) names its settings `fields`
  instead (e.g. `["url", "token"]`, declared in the manifest as text/number/secret): the card shows them
  as a Connect form (secrets write-only, as in Secrets), the generic Settings and Secrets sections leave
  them out, and after a save the shell runs `act(ctx, source, 'saved', {})` so the extension can test the
  connection and answer. Account passwords still never go through the web app.
  A secret that holds a list (calendar subscription links) is declared with `"multiple": true`: the card
  shows one row per item (only its host and last characters) with a remove button, and a field with
  [+] that adds one. It stays one secret, one item per line, so `ctx.secrets.get` returns a string
  (older values separated by spaces read the same).

**System**: the terminal and the browser (spec 004; Claude and Codex run in the terminal on the owner's
subscriptions, no AI API keys in the app), the app password (when not pinned by `APP_PASSWORD_HASH`) and
profiles.

Extensions are not installed from this page: `ext install` or Claude does it (see "Claude building extensions").

### Claude talks to the extensions

Every extension is reachable by Claude through the `assistant` MCP server, with generic tools from the
shell and its own: see [005-claude-tools.md](005-claude-tools.md). Extensions only show, store and fetch
data; Claude combines them (a training plan from health data and the gym tracker).

### Dashboard

The home page is a grid of tiles, one or more per extension: see
[003-dashboard-tiles.md](003-dashboard-tiles.md).

### Install and first run

`install.sh` is the one command for a NAS or any Docker host: it clones (if needed), writes `.env` with
fresh random secrets (mode 600), installs the extensions named as its arguments, starts the stack, enables `tailscale serve` when Tailscale is present
and prints a one-time setup code. The first visit goes to `/setup` (code + app password + first
profile); after that everything is configured from System settings. The password hash is stored in
`secrets.app_config`; `APP_PASSWORD_HASH` in `.env` still wins, for existing installs.

## Trust model

Written with the security review in [spec 004](004-security.md). What each kind of extension can do if
its author is careless or hostile, and what stops it:

| | onefile | native |
|---|---|---|
| Runs | in the browser, sandboxed iframe with an opaque origin | in the web process, with the shell's privileges |
| Reaches the shell's cookies, API, other extensions | no | yes: `process.env`, any import, `RESET ROLE` inside `ctx.db` |
| Network | none (`connect-src 'none'`, no popups, external navigation blocked by `frame-src 'self'`) | anything |
| Data | its own KV rows | whatever `app_rw` can read |
| Isolation is | **enforced** by the browser | **advisory**: `ext_<id>` roles and secret grants stop bugs, not malice |

So:

- **onefile** extensions may come from anywhere the owner chooses to run them.
- **native** extensions are code the owner trusts as much as the shell itself. They are the only user and
  the app is on their tailnet, so any source may inspire one; Claude writes the code here, and the lint still refuses dangerous migrations and shell-internal imports.
- **Database migrations** of an extension never run as the superuser. `db/migrate.sh` creates the schema
  owned by `ext_<id>_owner`, gives that role LOGIN with a random password for the run, applies the files
  connected as it, and sets it back to NOLOGIN. Even a hostile migration can only touch its own schema:
  no roles, no other schemas, no `secrets`, no `COPY ... PROGRAM`, and `RESET ROLE` has nowhere to go.
  The runtime role `ext_<id>` gets DML only (no DDL, no TRUNCATE). A line
  `CREATE SCHEMA IF NOT EXISTS <own schema>;` is skipped, because the schema already exists and the owner
  may not create schemas.
- Keys: AI calls go through `ctx.ai` (the key never leaves the shell). Other secrets need a manifest
  entry and an admin grant, and only native extensions can receive them (see above for what that means).

## Next

- More ready-made extensions in the extensions repo: Home Assistant (from `inspirations/home-assistant`),
  calendar, learning, Strava or Apple Health as data sources.
- `ext update` for every installed extension from a schedule, like the shell's auto-update.
