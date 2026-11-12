# Spec 004: Security model, credentials, in-app terminal and browser

Status: **Implemented (terminal, browser), reviewed (shell, extensions), audited 2026-11-06 (see "Audit")** · 2026-11-06

## Goal

The assistant now holds things worth stealing: extension secrets, CLI logins (Claude Code,
Codex, GitHub), and signed-in browser sessions that Claude can use on the owner's behalf. This spec says
where each credential lives, who can reach it, and how the two new admin tools (a terminal and a
browser inside the app) are isolated.

## Threat model

| Actor | Can | Must not |
|---|---|---|
| Someone on the internet | nothing, while the Claude connector is off: the app is reachable only on the tailnet (Tailscale Serve). With it on: the MCP listener's discovery files, client registration and the sign-in page (Tailscale Funnel, spec 005) | anything without the app password or a token from it; any other path (the public listener answers 404) |
| A Claude connector client (OAuth, approved in the app on the tailnet) | the MCP tools of the apps of its address, for its profile; writes only where the address allows; never raw SQL or raw saved data | the app's pages, settings, terminal, browser; tokens of other connections |
| Device on the tailnet without the password | see `/login` | anything else |
| Profile user (knows the app password) | use extensions | open System settings without re-entering the password; read stored keys |
| Admin (re-entered the password in the last 10 min) | System settings, terminal, browser, extension secrets | read a stored API key back in the UI (write-only) |
| A onefile extension | its own KV data | the shell's cookies, API, other extensions (opaque-origin iframe) |
| A native extension | everything the web process can | is **trusted code**: see "Extensions" |
| An extension's background work (in the `worker`) | its own tables (`ext_<id>_svc`, its own password), its folder (read), its `WORKER_DATA`, the internet, the host's `/proc` and `/sys` (read-only) | other extensions' files, logins or data; the supervisor's environment (`SERVICES_DB_PASSWORD`); other processes' environment; the Docker socket, `.env`, the `logs` volume, any port |
| A web page open in the in-app browser | whatever page JS can | reach the sidecars network services other than through the browser itself |
| Prompt injection reaching Claude | what Claude's tools can do, which includes editing code that `web` and extension services run (see "Audit", A1) | read `.env` directly, the Docker socket |

## Where credentials live

| Credential | Stored in | Readable by |
|---|---|---|
| App password | `APP_PASSWORD_HASH` (scrypt) in `.env` | web |
| Extension secrets | `secrets.extension_secrets`, AES-256-GCM, key `SECRETS_KEY` from `.env` | web only; an extension reads only the names it declares; never sent back to the browser, only a hint |
| Claude tools token | `CLAUDE_TOOLS_TOKEN` in `.env` (spec 005); refused on the public listener | web, terminal |
| Claude connector tokens | `core.oauth_tokens`, SHA-256 hashes only (spec 005) | web (`app_rw`); not `claude_ro` |
| Extension service logins (e.g. Garmin) | `<id>.secret_*` tables, Fernet (`TOKEN_ENCRYPTION_KEY`) | that extension's service (`ext_<id>_svc`); the key only to units that list it in `keys` |
| Extension service database passwords | derived per role from `SERVICES_DB_PASSWORD` (`.env`) | the worker's supervisor; each unit gets only its own extension's |
| Claude Code / Codex / gh logins | files in the `claude-home` volume | `terminal` container |
| Browser sessions (cookies) | `browser-profile` volume | `browser` container; usable over CDP from `terminal` |
| Sidecar ticket key | `SIDECAR_TICKET_SECRET` in `.env` | web, terminal |

`claude_ro` (Claude's data chat) has no access to `secrets` and no `SELECT` on `core.sessions` or the
OAuth tables. The `terminal` container sees an empty `.env`. Backups (db/backup.sh) hold the dump AND `.env`,
so they live outside the checkout (`BACKUP_DIR`, root-only files) and must be encrypted when copied off
the machine.

## Admin gate (step-up)

System settings (`/settings/*`) need an **elevated** session: the password typed again, valid 10
minutes (`core.sessions.elevated_until`). Every sensitive endpoint checks it itself as well, not only the
layout guard: the ticket endpoint below refuses without it.

## Terminal and browser sidecars

```
browser ── wss /settings/{terminal,browser}/ws?ticket=…  ──►  web (server.mjs)
                                                                │ Origin == ORIGIN?
                                                                │ session cookie present?
                                                                │ ticket valid, unused, for this sidecar AND this session?
                                                                ▼
                                             sidecars network (internal: no internet, no other services)
                                     ┌──────────────────────────┴───────────────────────────┐
                              terminal:7681 (re-checks ticket)                     browser:6080 (noVNC)
                              shell in tmux, Claude Code,                          Chromium on Xvfb,
                              Codex, claude-home + checkout                        browser-profile volume
                                                                                   CDP :9223 ──► terminal (playwright MCP)
```

- **Tickets** (`sidecar-ticket.js`, same code in `services/terminal/ticket.mjs`): HMAC-SHA256 over
  `{aud, sha256(session id), exp = now + 60 s, nonce}`. Minted by `POST /settings/ticket` for an elevated
  session only; each nonce is accepted once by the proxy and once by the terminal. A leaked ticket is
  useless without the session cookie, after 60 s, or after first use. Cross-site WebSocket hijacking is
  stopped by the Origin check (browsers do not apply CORS to WebSockets).
- **Terminal**: own container (`docker/terminal`); no Docker socket, no `.env`, no port. The shell
  gets a clean environment (the ticket key is not in it). Claude Code, Codex and gh are signed in here
  (`claude` then `/login`, `codex login --device-auth`, `gh auth login`; logins in `claude-home`) and run
  only here: nothing runs them in the background and nothing reaches them from outside (Remote Control was
  removed; the Claude connector replaces it). tmux keeps a session alive across reconnects. Sessions end
  after 8 h. The terminal lives only in the dock at the bottom of every page, and the dock exists only
  while the session is unlocked (the lock in the header). `GET /dock` (any logged-in session) returns
  sign-in booleans, never file contents, plus whether the session is unlocked. Opening a shell needs the
  unlock and a ticket. Opened and closed sessions are logged (`/logs/web.log`, `docker compose logs terminal`).
- **Agents in the terminal: full access, critical changes approved.** Claude Code and Codex may edit any
  file, use every extension (MCP tools, `ext`), and read and write data (`beni-db`, role `agent_rw`)
  without asking. They ask the owner first before a critical change: a push that can reach main, a force
  push or branch deletion, merging a PR, `git reset --hard`/`clean -f`, SQL that deletes data or changes
  schema or roles, `rm -r` outside scratch folders, removing an extension, or changing their own permission
  settings. Claude: `/etc/claude-code/managed-settings.json` (allow list, bypass mode off) and its
  PreToolUse hook `beni-guard.mjs`, both root-owned in the image. Codex: `approval_policy = "on-request"`
  and the execpolicy rules `beni.rules`. Hard limits behind them, which no prompt can talk past:
  `agent_rw` owns nothing (no DDL, no `TRUNCATE`, no `secrets`, sessions or connector tokens); nothing from
  the checkout runs as the database superuser (core migrations are baked into the migrate image from main,
  spec 006); the updater deploys only main, and an extension's `compose.yml` that could reach the host
  (privileged, Docker socket, host paths...) is not started (`scripts/compose-policy.sh`). See
  `docker/terminal/README.md`.
- **Browser**: Chromium with a persistent profile on a virtual display. x11vnc listens on loopback
  only (no VNC password); websockify (noVNC) accepts only handshakes with `Origin: $PUBLIC_ORIGIN`, which
  the web proxy sends and a page inside this browser cannot; websockify and a CDP bridge listen on the internal `sidecars` network, which only web,
  terminal and browser join. The browser reaches the internet through its own `browser-egress`
  network, so a page cannot reach Postgres or extension services. Chromium runs with `--no-sandbox` (Docker
  blocks the user namespaces its sandbox needs); the container is the sandbox: non-root, no secrets
  except its own profile, no host mounts.
- **Claude drives the browser** through the `browser` MCP server (`.mcp.json`, `@playwright/mcp`
  over CDP at `localhost:9222`, forwarded by socat in the terminal container). Enable it once in Claude
  Code when asked (project MCP servers need approval).

### Risks we accept, and what limits them

- With the Claude connector on, the sign-in page is on the internet. It asks for nothing: a connection
  exists only once the owner approves its code in the app on the tailnet, and codes go back only to
  Claude's own callback hosts. Limits on what it gets: the profile, apps and writes of its MCP address,
  short access tokens, a 180-day end, the tool call log, Remove, and the switch that ends every connection.

- Whoever has an elevated session has a shell with the owner's CLI logins and the browser's sessions.
  That is the feature. Limits: tailnet only, password re-entry, 10-minute window, logs.
- Pages Claude visits can carry prompt injection, and the browser is signed in. Sign in only to what
  Claude should use, sign out when done, and prefer read-only accounts or app passwords where a service
  offers them. `@playwright/mcp --allowed-origins` can narrow Claude to listed sites if wanted.

## Extensions (review of spec 002)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Extension migrations run as the Postgres superuser: a third-party repo could alter roles, read `secrets`, or `COPY … TO PROGRAM` | Critical | Fixed: applied while connected as `ext_<id>_owner` (LOGIN with a random password for the run only); tested against an existing database and with hostile migrations |
| 2 | Native extensions run in the web process: `process.env`, `RESET ROLE` inside `ctx.db`, private imports | High | By design: ext roles and secret grants stop bugs, not malice. Install native extensions only from repos the owner controls, pinned to a commit SHA (`ext install` records it) |
| 3 | onefile iframe could open popups or navigate itself to an external URL, leaking its data in the URL despite `connect-src 'none'` | Medium | Fixed: `allow-popups` removed; the shell's `frame-src 'self'` blocks external self-navigation |
| 4 | No anti-framing header on shell pages | Medium | Fixed: `frame-ancestors 'none'` in the shell CSP (pages), `X-Frame-Options: SAMEORIGIN` on every response (endpoints too) |
| 5 | Login rate limit keyed on `127.0.0.1` behind Tailscale Serve (global limit, easy lockout) | Low | Open: set `ADDRESS_HEADER=X-Forwarded-For` + `XFF_DEPTH=1` on web once it is confirmed that every request arrives through Tailscale Serve (adapter-node fails requests without the header) |

## Audit (2026-11-06, after PR #7)

Single user, tailnet only: the bar is "no easy way from a web page or a leaked token to the keys", not
defence against the owner's own Claude.

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Claude (and anything that injects a prompt into it) is effectively admin: it edits code that runs live in `web` (has `SECRETS_KEY`, `SIDECAR_TICKET_SECRET`, `app_rw`) and in extension services (e.g. `garmin-sync`: root, `TOKEN_ENCRYPTION_KEY`), and `ext-migrate` applied new `db/migrations/*.sql` as the Postgres superuser within 15 s. Hiding `.env` stops accidents, not a determined prompt injection | High (by design) | Partly fixed 2026-11-12: core migrations only from main (migrate image), critical agent actions need the owner's approval (see "Agents in the terminal"). Accepted: it is the "Claude builds the app" feature. Limits: review Claude's commits, keep the browser signed in only where needed, do not let Claude browse untrusted pages and edit code in the same session without reading what it did |
| A2 | `<id>__query` ran the SQL as `app_rw` after `SET LOCAL ROLE ext_<id>`; `set_config('role','none',true)` + `query_to_xml(...)` in one SELECT climbed back to `app_rw` and read `core.sessions` (session ids, so an elevated session and a terminal ticket), the password hash and extension secret ciphertexts. Reproduced on Postgres 16 | High | Fixed: the SQL runs inside `ext_query.<schema>(text)`, a security-definer function owned by `ext_<id>` (migration 009, `db/extension-role.sql`); Postgres refuses any role change inside it |
| A3 | noVNC (websockify :6080) had no origin check and VNC has no password: any web page open in the in-app browser (or one Claude visits) could open `ws://localhost:6080` and drive the signed-in browser | High | Fixed: websockify `ExpectOrigin` = `PUBLIC_ORIGIN`, the web proxy sends that Origin (needs a browser image rebuild) |
| A4 | Changing the app password left every other session logged in for up to 30 days | Medium | Fixed: the password action deletes every other session |
| A5 | Session ids are stored in plain text in `core.sessions` (a database read = a session) | Medium | Open: store `sha256(id)`; one migration plus a forced re-login |
| A6 | Login and unlock rate limits are keyed on the proxy address (finding 5 above), so one tailnet device can lock everyone out for 15 min | Low | Open, as above |
| A7 | `ctx.db` of native extensions has the same `SET LOCAL ROLE` escape as A2 | Low | By design (finding 2): native extension code is trusted, it runs in the web process anyway |
| A8 | Chromium runs with `--no-sandbox`: a renderer exploit runs in the browser container, which can reach `web:3000`, `terminal:7681` (needs a ticket) and its own CDP | Low | Accepted (spec above) |
| A9 | Extension secrets are AES-GCM without associated data: a database writer could swap two ciphertexts between extensions | Low | Open: bind `extension_id/name` as AAD on the next change to `secret-box.ts` |
| A10 | Extension services such as health's `garmin-sync` run as root and `pip install`s `requirements.txt` from the checkout on every start | Low | Fixed for the worker (2026-11-12): each extension runs, and installs its requirements, as its own uid; still true for an extension's own `compose.yml` |
| A11 | Every unit in the worker can read the host's `/proc` and `/sys` (process list and command lines of the machine, hardware), whether its manifest lists `host` or not: one container, one set of mounts | Low | Accepted: read-only, no environment (other uids), no secrets in `/sys`; `host` in the manifest is for review and System settings -> Worker, and `ext check` refuses access the worker does not open. Per-unit mount namespaces would need privileges the worker should not have |
| A12 | Units of one extension share a uid, its folder and its database role, and all units share the worker's memory limit (1 GB) and network | Low | Accepted: one extension is one trust unit (its services already share `ext_<id>_svc`). A runaway unit is visible (memory per unit in System settings -> Worker) and restartable there |

The worker (`docker/worker`, spec 002 "Background work") is the only container that sees the host:
`/proc` and `/sys` read-only (listed in `docker/worker/access.json`, which a test keeps equal to the
compose file) and the host name (`uts: host`). Its supervisor is the one process there that runs as root,
with only the capabilities it needs to hand out users (CHOWN, DAC_OVERRIDE, FOWNER, KILL, SETGID,
SETUID) and `no-new-privileges`; it comes from the image the updater builds from main, not from the
checkout, and never runs extension code itself: it reads manifests and file metadata, then starts each
unit as the extension's uid with an environment built from scratch. Units cannot read
`/proc/<pid>/environ` of the supervisor or of host processes (other uids). The worker does not mount the
`logs` volume, so no unit can write the updater's control file; the app's requests to the worker go
through `/worker/control`, writable by the web app (HOST_UID) only.

Checked and fine: no Docker socket in any container (auto-update runs on the host and trusts only its
own mirror of GitHub main, spec 006), only `web` publishes a port (127.0.0.1), CSRF (SvelteKit
origin check for forms, explicit Origin check on `PATCH /api/kv`, JSON endpoints need a CORS preflight),
WebSocket Origin + ticket checks, CSP and the onefile sandbox, the `/mcp` bearer checks (constant time for
`CLAUDE_TOOLS_TOKEN`, which the public listener refuses; hashed OAuth tokens), extension migrations as `ext_<id>_owner`, secrets never sent back to the UI.

## Deploy (human steps)

```sh
echo "SIDECAR_TICKET_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build        # terminal + browser containers
```

After the 2026-11-06 audit: `docker compose up -d --build browser` (noVNC origin check, A3). Migration 009
and the query functions (A2) are applied by `ext-migrate` on its own.

Then the terminal in the dock at the bottom of the app: `claude` → `/login`; `codex login --device-auth` for ChatGPT.
System settings → Browser: sign in where needed. Without `SIDECAR_TICKET_SECRET` both pages say so and
every connection is refused.
