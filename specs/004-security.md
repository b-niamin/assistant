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
| Someone on the internet | nothing: the app is reachable only on the tailnet (Tailscale Serve), no published port but `127.0.0.1:3000` | reach any container |
| Device on the tailnet without the password | see `/login` | anything else |
| Profile user (knows the app password) | use extensions | open System settings without re-entering the password; read stored keys |
| Admin (re-entered the password in the last 10 min) | System settings, terminal, browser, extension secrets | read a stored API key back in the UI (write-only) |
| A onefile extension | its own KV data | the shell's cookies, API, other extensions (opaque-origin iframe) |
| A native extension | everything the web process can | is **trusted code**: see "Extensions" |
| A web page open in the in-app browser | whatever page JS can | reach the sidecars network services other than through the browser itself |
| Prompt injection reaching Claude | what Claude's tools can do, which includes editing code that `web` and extension services run (see "Audit", A1) | read `.env` directly, the Docker socket |

## Where credentials live

| Credential | Stored in | Readable by |
|---|---|---|
| App password | `APP_PASSWORD_HASH` (scrypt) in `.env` | web |
| Extension secrets | `secrets.extension_secrets`, AES-256-GCM, key `SECRETS_KEY` from `.env` | web only; an extension reads only the names it declares; never sent back to the browser, only a hint |
| Claude tools token | `CLAUDE_TOOLS_TOKEN` in `.env` (spec 005) | web, claude, terminal |
| Extension service logins (e.g. Garmin) | `<id>.secret_*` tables, Fernet (`TOKEN_ENCRYPTION_KEY`) | that extension's service (`ext_<id>_svc`) |
| Claude Code / Codex / gh logins | files in the `claude-home` volume | `claude` and `terminal` containers |
| Browser sessions (cookies) | `browser-profile` volume | `browser` container; usable over CDP by `claude` |
| Sidecar ticket key | `SIDECAR_TICKET_SECRET` in `.env` | web, terminal |

`claude_ro` (Claude's data chat) has no access to `secrets` and no `SELECT` on `core.sessions`. The
`claude` and `terminal` containers see an empty `.env`. Backups contain only ciphertext: keep `.env`
backed up separately, or the backups cannot decrypt extension secrets and service logins.

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
                              shell in tmux, claude image,                         Chromium on Xvfb,
                              claude-home + checkout                               browser-profile volume
                                                                                   CDP :9223 ──► claude (playwright MCP)
```

- **Tickets** (`sidecar-ticket.js`, same code in `services/terminal/ticket.mjs`): HMAC-SHA256 over
  `{aud, sha256(session id), exp = now + 60 s, nonce}`. Minted by `POST /settings/ticket` for an elevated
  session only; each nonce is accepted once by the proxy and once by the terminal. A leaked ticket is
  useless without the session cookie, after 60 s, or after first use. Cross-site WebSocket hijacking is
  stopped by the Origin check (browsers do not apply CORS to WebSockets).
- **Terminal**: own container from the claude image; no Docker socket, no `.env`, no port. The shell
  gets a clean environment (the ticket key is not in it). It shares `claude-home` with the `claude`
  container on purpose: `claude` then `/login`, `codex login --device-auth`, `gh auth login` typed here
  are what Claude Remote uses. tmux keeps a half-finished login alive across reconnects. Sessions end
  after 8 h. The terminal lives only in the dock at the bottom of every page; `GET /dock` (any logged-in
  session) returns sign-in booleans and Remote Control states, never file contents, plus whether the
  session is unlocked. Opening a shell still needs the unlock and a ticket.
- **Remote Control**: the `claude` container's entrypoint keeps `claude remote-control` and, once Codex
  is signed in, `codex remote-control --no-daemon` running in `/workspace`, restarting them with backoff.
  Each writes its state to `~/.beni/remote/<agent>.json` (heartbeat every 30 s); the terminal's `/status`
  reports it, and a stale file reads as off. The Remote menu can also start one in the background of the
  terminal container (`POST /dock` for an unlocked session -> `POST terminal:7681/remote` with a
  single-use ticket; fixed commands only, in tmux session `remote-<agent>`). Opened and closed sessions are logged (`/logs/web.log`, `docker compose logs terminal`).
- **Browser**: Chromium with a persistent profile on a virtual display. x11vnc listens on loopback
  only (no VNC password); websockify (noVNC) accepts only handshakes with `Origin: $PUBLIC_ORIGIN`, which
  the web proxy sends and a page inside this browser cannot; websockify and a CDP bridge listen on the internal `sidecars` network, which only web,
  claude, terminal and browser join. The browser reaches the internet through its own `browser-egress`
  network, so a page cannot reach Postgres or extension services. Chromium runs with `--no-sandbox` (Docker
  blocks the user namespaces its sandbox needs); the container is the sandbox: non-root, no secrets
  except its own profile, no host mounts.
- **Claude drives the browser** through the `browser` MCP server (`.mcp.json`, `@playwright/mcp`
  over CDP at `localhost:9222`, forwarded by socat in the claude container). Enable it once in Claude
  Code when asked (project MCP servers need approval).

### Risks we accept, and what limits them

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
| A1 | Claude (and anything that injects a prompt into it) is effectively admin: it edits code that runs live in `web` (has `SECRETS_KEY`, `SIDECAR_TICKET_SECRET`, `app_rw`) and in extension services (e.g. `garmin-sync`: root, `TOKEN_ENCRYPTION_KEY`), and `ext-migrate` applies new `db/migrations/*.sql` as the Postgres superuser within 15 s. Hiding `.env` stops accidents, not a determined prompt injection | High (by design) | Accepted: it is the "Claude builds the app" feature. Limits: review Claude's commits, keep the browser signed in only where needed, do not let Claude browse untrusted pages and edit code in the same session without reading what it did |
| A2 | `<id>__query` ran the SQL as `app_rw` after `SET LOCAL ROLE ext_<id>`; `set_config('role','none',true)` + `query_to_xml(...)` in one SELECT climbed back to `app_rw` and read `core.sessions` (session ids, so an elevated session and a terminal ticket), the password hash and extension secret ciphertexts. Reproduced on Postgres 16 | High | Fixed: the SQL runs inside `ext_query.<schema>(text)`, a security-definer function owned by `ext_<id>` (migration 009, `db/extension-role.sql`); Postgres refuses any role change inside it |
| A3 | noVNC (websockify :6080) had no origin check and VNC has no password: any web page open in the in-app browser (or one Claude visits) could open `ws://localhost:6080` and drive the signed-in browser | High | Fixed: websockify `ExpectOrigin` = `PUBLIC_ORIGIN`, the web proxy sends that Origin (needs a browser image rebuild) |
| A4 | Changing the app password left every other session logged in for up to 30 days | Medium | Fixed: the password action deletes every other session |
| A5 | Session ids are stored in plain text in `core.sessions` (a database read = a session) | Medium | Open: store `sha256(id)`; one migration plus a forced re-login |
| A6 | Login and unlock rate limits are keyed on the proxy address (finding 5 above), so one tailnet device can lock everyone out for 15 min | Low | Open, as above |
| A7 | `ctx.db` of native extensions has the same `SET LOCAL ROLE` escape as A2 | Low | By design (finding 2): native extension code is trusted, it runs in the web process anyway |
| A8 | Chromium runs with `--no-sandbox`: a renderer exploit runs in the browser container, which can reach `web:3000`, `terminal:7681` (needs a ticket) and its own CDP | Low | Accepted (spec above) |
| A9 | Extension secrets are AES-GCM without associated data: a database writer could swap two ciphertexts between extensions | Low | Open: bind `extension_id/name` as AAD on the next change to `secret-box.ts` |
| A10 | Extension services such as health's `garmin-sync` run as root and `pip install`s `requirements.txt` from the checkout on every start | Low | Open: `user: ${HOST_UID}` once the venv volume is chowned |

Checked and fine: no Docker socket in any container (auto-update runs on the host and trusts only its
own mirror of GitHub main, spec 006), only `web` publishes a port (127.0.0.1), CSRF (SvelteKit
origin check for forms, explicit Origin check on `PATCH /api/kv`, JSON endpoints need a CORS preflight),
WebSocket Origin + ticket checks, CSP and the onefile sandbox, `/api/claude` bearer check (constant time,
fails closed on other paths), extension migrations as `ext_<id>_owner`, secrets never sent back to the UI.

## Deploy (human steps)

```sh
echo "SIDECAR_TICKET_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build        # new terminal + browser containers, rebuilt claude image
```

After the 2026-11-06 audit: `docker compose up -d --build browser` (noVNC origin check, A3). Migration 009
and the query functions (A2) are applied by `ext-migrate` on its own.

Then the terminal in the dock at the bottom of the app: `claude` → `/login`; `codex login --device-auth` for ChatGPT.
System settings → Browser: sign in where needed. Without `SIDECAR_TICKET_SECRET` both pages say so and
every connection is refused.
