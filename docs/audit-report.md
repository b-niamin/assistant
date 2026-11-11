# Audit report

One checklist for the eleven audits of 2026-11-11 (security, UI/UX and typography, common web issues,
architecture, backups, dependencies and Docker, data privacy, tests and CI, monitoring, accessibility,
extension docs). Each finding appears once, even when several audits raised it; the source tags say which.
Items in `assistant-extensions` say so (`ext:`).

`[x]` = fixed (commit noted), `[ ]` = open, *other thread* = being fixed in the thread "Fix Claude auto-update
and agent permissions", **needs you** = a step only the owner can take (NAS, GitHub
settings, Tailscale admin, password manager).

Sources: SEC security, UX UI/UX and typography, WEB common web issues, ARCH architecture, BAK backups,
DEP dependencies and Docker, PRIV data privacy, CI tests and CI, MON monitoring, A11Y accessibility,
DOC extension docs.

## 1. Claude connector (MCP, OAuth, Funnel)

- [ ] **C1** A grant is not bound to a profile: every tool takes any `profile`, and `<id>__query` reads
  every profile's rows. Bind the grant to its profile, reject others; filter `query` by profile.
  (SEC S2, PRIV 1, ARCH)
- [ ] **C2** Raw SQL (`query`, `describe`) and `read_data` are reachable from the internet. Off by default
  on the connector; terminal keeps them. (PRIV 2)
- [ ] **C3** One scope `mcp` for everything. Add `mcp:read` / `mcp:write`, picked on the consent page,
  read-only by default; tools outside the scope are left out of `tools/list`. (SEC S3, ARCH 3, PRIV 2)
- [ ] **C4** Open client registration with any https redirect URI lets anyone phish a consent. Allow only
  claude.ai / claude.com callbacks and loopback (editable list), warn on anything else. (SEC W2, PRIV 7)
- [ ] **C5** The app password is typed on the public authorize page and the rate limit is global
  (~960 guesses a day, and anyone can lock the owner out). Approve new connections in the app on the
  tailnet instead; the public page only waits. Until then: per-client limits and failed-attempt logging.
  (SEC W3, N2, ARCH 7, PRIV 8)
- [ ] **C6** No log of tool calls. `core.tool_calls` (time, grant/terminal, profile, tool, ok/error,
  duration, no arguments) and a list in System settings -> Claude connector. (ARCH 3, PRIV 4, MON 7)
- [ ] **C7** Home is exposed through the connector (doors, lights, presence, calendar with places).
  Opt-in per extension for the connector; refresh tokens with a hard maximum lifetime. (PRIV 3)
- [ ] **C8** `oauth_grants.profile_id` has no foreign key; a deleted profile leaves an orphan grant.
  (ARCH)
- [ ] **C9** Tool errors ride on SvelteKit `error()`; use an own `ToolError`. Core validates arguments
  against `input` before `run`. (ARCH)
- [ ] **C10** `capabilities.tools.listChanged: false` while tools change with extensions; say in the
  connector panel that a reconnect shows new tools. (ARCH)
- [ ] **C11** `X-Robots-Tag: noindex` on every response (the MCP host is public). (WEB)

## 2. Agent in the terminal, updater, deployment

- [ ] **D1** *other thread*: The terminal agent can reach root on the host: it edits code that `web` builds with every
  secret, adds a migration that `ext-migrate` runs as the Postgres superuser, or pushes to `main` which the
  updater deploys as root. (SEC K1, ARCH 2)
  - [ ] D1a *other thread*: `ext-migrate` applies core migrations only from `main` (the updater's mirror), never from the
    checkout. (SEC K1)
  - [ ] D1b *other thread*: Agents ask before running commands (Claude default mode, Codex `approval_policy = "on-request"`).
    (SEC S4)
  - [ ] D1c **needs you**: protect `main` on GitHub (ruleset: no force push, no deletion), sign commits,
    agent token limited to `claude/*` branches. (SEC K1)
  - [ ] D1d Long term: `web` runs an image built by CI (GHCR digest), not a bind mount of `apps/web`;
    agent works in a separate preview stack without real secrets. (SEC deep 2, ARCH 2)
- [ ] **D2** The root updater follows symlinks in the `logs` volume, which containers write
  (`chown`, `chmod`, `>>`, heartbeat). Refuse symlinks before every write, `chown -h`, temp file + `mv`.
  (SEC W1)
- [ ] **D3** `updater-control` (incl. `funnel=on`) lives in `logs`, writable by every extension service
  (garmin-sync runs as root). Move it to its own `control` volume mounted only in `web`. (ARCH 5, SEC W1)
- [ ] **D4** Extension `compose.yml` is any compose fragment run as root. Validate it on install/update:
  no `privileged`, `cap_add`, `network_mode: host`, `pid`, `devices`, `docker.sock`, bind mounts outside
  the extension. (SEC W4, ARCH 6)
- [ ] **D5** `ext install` / `update` validate only the manifest. Run the full `ext check` before copying
  in, keep the old copy on failure; record the commit installed. (CI 3, SEC W4)
- [ ] **D6** Extension server code runs in `web` with `process.env` and can `RESET ROLE`. Document the
  trust model in spec 002 now; long term a separate extension host with its own DB login. (SEC W4, ARCH)
- [ ] **D7** Base images never refresh: no `pull` / `build --pull`. Weekly pull + rebuild in the updater;
  pin exact tags. (DEP 1, SEC N5)
- [ ] **D8** *other thread*: `terminal`: `~/.npm-global/bin` first in PATH and writable, `cli-home.mjs` keeps a newer copy
  from the volume. (SEC S5)
- [ ] **D9** Chromium runs with `--no-sandbox` and a signed-in profile on the same network as `web`.
  Separate network for browser + terminal. (SEC S1)
- [ ] **D10** SSRF: ICS / Home Assistant URLs are fetched from `web`, which sees `db`, `browser:9223`,
  `terminal:7681`. Block private addresses and stack service names except an explicitly set HA host.
  (SEC S8)
- [ ] **D11** Migrations named by number collide between parallel threads; new files get a timestamp
  name and CI checks the order. (ARCH 10, SEC N6)
- [ ] **D12** Live-reload swaps the build in without tests; one broken extension blocks every later
  change. Retry without the failing extension and flag it. (ARCH, CI 5)
- [ ] **D13** Memory: `browser` and `terminal` run all day; start on demand. (ARCH, DEP 5)

## 3. Backups and recovery

- [ ] **B1** Dumps live in a Docker volume on the same disk as the database (Synology Hyper Backup does
  not see `@docker`). `BACKUP_DIR` as a host folder. (BAK P0, ARCH, MON 1)
- [ ] **B2** `.env` (with `SECRETS_KEY`, `TOKEN_ENCRYPTION_KEY`) is never backed up; without it the dump's
  secrets are lost. Include it, encrypted. (BAK P0, ARCH 1)
- [ ] **B3** `extensions/` is git-ignored and in no backup; locally built extensions vanish with the disk.
  Include in the backup; give `extensions/` its own git history. (BAK P0, ARCH 1)
- [ ] **B4** `backup.sh` prunes old dumps even when new ones fail, writes straight to the final name,
  drifts with `sleep 86400`. Atomic write, `pg_restore --list` check, prune only after success, fixed
  hour, daily/weekly/monthly retention. (BAK P1)
- [ ] **B5** Nobody notices failed backups: status only on stdout. `/logs/backup.log` +
  `/logs/backup-status.json`, shown in the app and in `beni.sh doctor`. (BAK P1, MON 1)
- [ ] **B6** No restore procedure; the hint in compose does not work. `beni.sh backup` / `restore` and a
  section in docs/install.md. (BAK P1)
- [ ] **B7** No dump before schema changes (update, ext-migrate). (BAK P2)
- [ ] **B8** Dumps are unencrypted health data; encrypt the bundle (age/openssl) before it leaves the
  machine. (BAK P3, SEC S6)
- [ ] **B9** Weekly restore test into a scratch database, result in the status. (BAK, MON 1)
- [ ] **B10** **needs you**: copy `.env` into the password manager and `extensions/` + latest dump off
  the NAS today. (BAK)
- [ ] **B11** **needs you**: an off-machine target (second tailnet device or rclone/restic) for the
  bundle. (BAK)

## 4. CI, tests, dependencies

- [ ] **T1** No CI in either repo. Core: `npm test`, `npm run check`, terminal tests, `update.test.sh`,
  `sh -n`. (CI P1, ARCH 9, DEP 2)
- [ ] **T2** ext: no automation. CI checks out core `main`, copies the extensions in, runs `ext check`,
  vitest, svelte-check and pytest; checks `catalog.json` against the folders. (CI P1)
- [ ] **T3** **needs you**: require green CI on `main` (branch protection), and the updater deploys only
  green commits. (CI P1)
- [ ] **T4** Dependabot for npm, docker, pip, github-actions in both repos. (DEP 2)
- [ ] **T5** ext: garmin-sync `pip install` on every start without a lock; `curl_cffi>=0.6` floats;
  pytest in the production venv; runs as root. Image built once, pinned, non-root. (DEP 3, SEC S7, ARCH)
- [ ] **T6** `llm`/`terminal` image built twice (no shared `image:`). (DEP 4)
- [ ] **T7** *other thread*: Claude Code not pinned in the terminal image, Codex pinned. (DEP 7, SEC N5)
- [ ] **T8** Untested high-risk code: `hooks.server.ts`, `session.ts`, kv / onefile APIs,
  `extension-secrets.ts`, `migrate.sh`, `backup.sh`; ext `*.server.ts`, `store.py`, gym `app.html`. (CI P2)
- [ ] **T9** Browser e2e + axe-core in CI (light, dark, phone). (CI P3, UX deep 5, A11Y)
- [ ] **T10** `SHELL_API = 1` never bumped though the contract grew; semver for `$shell`. (ARCH, CI 4)

## 5. Data integrity

- [ ] **I1** Gym: a failed save is dropped without retry. Merge back into `pending`, retry with backoff,
  retry on `online` / `visibilitychange`. (WEB 1)
- [ ] **I2** Gym: the save on tab close uses `keepalive`, which browsers cap at 64 KB. Save on
  `visibilitychange: hidden` with a normal fetch. (WEB 1)
- [ ] **I3** Gym / onefile KV: the whole journal is one key; a stale tab or the app overwrites what the
  phone or Claude wrote. Version per key, 409 on conflict, the host reloads the app. (WEB 1, ARCH 4)
- [ ] **I4** "Today" is UTC in health and SQL (`current_date`, `toISOString`); between midnight and
  1-2 a.m. the app shows yesterday. `todayIn(tz)` in `$shell` and the DB session time zone. (WEB 4)
- [ ] **I5** Profile from the cookie is not checked; a deleted profile gives an empty dashboard and a raw
  id. (WEB P3)

## 6. Monitoring

- [ ] **M1** `/healthz` always says `ok`. Check the database, 503 when it is down. (MON 2)
- [ ] **M2** Only `db` has a healthcheck. Add them for `web` and heartbeat services. (MON 2)
- [ ] **M3** One status contract: every service writes `/logs/<service>-status.json`; a "System status"
  panel, Beni's mood and a `system__status` MCP tool read them; optional ntfy push. (MON 2)
- [ ] **M4** ext: Garmin sync shows green however old the last run is; `subprocess.call` without timeout
  can hang the loop forever; `partial` shows red; exceptions leave runs `running`. (MON 3)
- [ ] **M5** Logs grow forever: rotation for `/logs/*.log`, `max-size` for Docker logs. (MON 4)
- [ ] **M6** `backup`, `migrate`, `terminal`, `browser`, `db` log only to Docker; tee into `/logs`.
  (MON 5)
- [ ] **M7** No `handleError`: errors have no id; add one, log it, show it on the error page;
  `src/error.html` for a dead layout. (MON 6, WEB 8)
- [ ] **M8** Failed logins and rate-limit blocks leave no trace. (MON 7)
- [ ] **M9** A failed extension migration or live-reload build is visible only in the log. (MON 8, 9)
- [ ] **M10** ext: garmin-sync has no `TZ`, so its lines on the Logs page are 1-2 h off. (MON 10)
- [ ] **M11** Log format differs per source; one convention and an "errors only" filter. (MON 11)
- [ ] **M12** Silent `catch` blocks in `sources.server.ts`, `readLogs`, dock. (MON 12)

## 7. Security, smaller

- [ ] **S1** Open redirect after login: `safeNext` lets `/\evil.com` through. (SEC N1, WEB P3)
- [ ] **S2** Session ids stored in clear text; store `sha256(sid)`. Sessions slide with activity.
  (SEC S6, WEB 8)
- [ ] **S3** AES-GCM without AAD: a ciphertext can be moved between extensions / names. (SEC N3)
- [ ] **S4** `/settings/**` guarded per route; one guard in `hooks.server.ts`. (SEC N4)
- [ ] **S5** Content from outside (ICS, HA names, notes) reaches agents unmarked; wrap as untrusted.
  (SEC S4)
- [ ] **S6** Install is `curl | sudo sh`; document "download, read, run". (SEC N5)
- [ ] **S7** Open-Meteo gets coordinates to ~11 m; round to 2 decimals. (PRIV 6)
- [ ] **S8** Home data is `scope: shared`, so one person's calendar is every profile's. (PRIV 5)
- [ ] **S9** Reserved extension ids miss `mcp`, `setup`, `dock` (existing routes). (DOC 7)

## 8. Accessibility and contrast

- [ ] **A1** `--ink-3` text is 3.1-3.5:1 in light (needs 4.5:1), used ~80 times. (UX 1, WEB 2, A11Y W1)
- [ ] **A2** White on `--accent` (primary button) is 4.4:1 light, 3.6:1 dark. (UX 4, WEB 2, A11Y W1)
- [ ] **A3** Field borders `--ring` are 1.2:1 (needs 3:1). (WEB 2, A11Y W2)
- [ ] **A4** `--critical` as error text is 3.6:1 in dark; past events in Home use `opacity: .45`.
  (A11Y W1)
- [ ] **A5** Keyboard trap in the terminal (Tab/Esc go to the shell, buttons push focus in). A reserved
  shortcut leaves it. (A11Y K1)
- [ ] **A6** ext: Home forecast rotates every 10 s and drops focus; ignores reduced motion. (A11Y K2,
  WEB P3)
- [ ] **A7** Terminal invisible to screen readers: `screenReaderMode` toggle, label. (A11Y W3)
- [ ] **A8** ext: Gym rest timer announces every second. (A11Y W4)
- [ ] **A9** ext: Home alerts live region re-reads every second. (A11Y W5)
- [ ] **A10** Focus lost after closing menus, the dock and Gym sheets. (A11Y W6)
- [ ] **A11** No skip link; sticky header and dock can hide the focused element; open dock does not make
  the page `inert`. (A11Y S1, S2, WEB 10)
- [ ] **A12** Selects / radios submit on change (health metric, settings). (A11Y S3)
- [ ] **A13** ext: Home tabs without `tabpanel`; Home has no `h1`; charts `role="img"` with arrow keys;
  StreamChart mouse only. (A11Y S4, N1, N2, N6)
- [ ] **A14** Terminal key buttons named "^C", "|"; label from the title. (A11Y S5)
- [ ] **A15** No in-app "reduce motion" switch. (A11Y S6)
- [ ] **A16** ext: Gym `#sheet` has no accessible name. (A11Y S7)
- [ ] **A17** Shared-tile icon `aria-label` on a span; logs `role="log"` keyed by index; theme/language
  radios without arrow keys; duplicate button names; Arrange moves not announced; `.sr` incomplete;
  smooth scroll and cursor blink ignore reduced motion. (A11Y S8, S9, N3-N5, N7, N8, WEB 10)
- [ ] **A18** ext: Gym recovery map relies on red/green only. (UX)

## 9. UI, typography, layout

- [ ] **U1** iOS zooms on every field (15 px). 16 px on `pointer: coarse`. (UX 3, WEB 3)
- [ ] **U2** On phones the dock bar covers the bottom of onefile apps (Gym tabs). (UX 2)
- [ ] **U3** ~30 font sizes and 6 weights; a 7-step type scale as tokens, three weights. (UX 5)
- [ ] **U4** Admin wording in the UI (`.env`, `SIDECAR_TICKET_SECRET`, `docker compose up -d`). (UX 6)
- [ ] **U5** Touch targets 28-34 px; `--control-h` 44 px on `pointer: coarse`. (UX 7, WEB 10)
- [ ] **U6** `:hover` rules stick after a tap; wrap in `@media (hover: hover)`. (UX 8)
- [ ] **U7** `meta theme-color` always orange; dark variant; manifest colours. (UX 10, WEB P3)
- [ ] **U8** `OnefileHost.svelte` uses a missing token `--bad`. (UX)
- [ ] **U9** `viewport-fit=cover` missing, so safe-area insets are always 0. (UX)
- [ ] **U10** Settings descriptions run 150 characters wide; `max-width: 68ch`. (UX)
- [ ] **U11** `ext check` warns about raw `font-size` / `font-weight` too. (UX)
- [ ] **U12** Phone navigation: hidden scrolling app list; bottom tabs below 640 px. (UX deep 3)
- [ ] **U13** Dashboard: "not connected" tiles take full space; group them. (UX)
- [ ] **U14** Settings page is 890 lines in one; split into sub-pages. (UX)
- [ ] **U15** Shared components in `$shell/ui` (Button, Card, ListRow, Stat, EmptyState, Tabs, Sheet).
  (UX deep 2)
- [ ] **U16** ext: Gym as a native extension (one key, 890 KB file, double navigation). (UX deep 4, WEB 1)
- [ ] **U17** Self-hosted variable font for consistent numbers. (UX)
- [ ] **U18** The header still has the Remote menu where the decision was a lock icon. (UX 9)

## 10. Web app behaviour

- [ ] **W1** ~20 `use:enhance` forms without a pending state: double submits, no feedback; the
  dashboard `layout` action error is never shown. (WEB 5)
- [ ] **W2** No navigation indicator; health metric links scroll to top and pile up history. (WEB 6)
- [ ] **W3** Settings waits up to 4 s for GitHub, the catalog up to 5 s; stream them. (WEB 7)
- [ ] **W4** Tiles that time out have no retry. (WEB 8)
- [ ] **W5** Numbers bypass the locale (`toFixed` gives "12.34 km"); `count-up.ts` writes into
  Svelte-managed text. (WEB 9)
- [ ] **W6** First-run wizard is English only. (WEB 9)
- [ ] **W7** Password-only login form; a hidden `username` field helps password managers. (WEB 10)
- [ ] **W8** No compression for dynamic responses (Gym `app.html` 890 KB each open). (WEB 11, UX)
- [ ] **W9** No service worker: an installed app off the tailnet shows a browser error. (WEB P3)
- [ ] **W10** During updates settings call `invalidateAll()` every 5 s. (WEB P3)
- [ ] **W11** Every language is bundled eagerly. (WEB P3)

## 11. Extension author docs

- [ ] **E1** The extension `AGENTS.md` template and spec 002 say to commit with `installed.json`, but
  `extensions/` is git-ignored. (DOC 1)
- [ ] **E2** ext: `inspirations/` are empty placeholders that fail `ext check`. (DOC 2)
- [ ] **E3** Skills point at `extensions/health|gym/web/tools.server.ts`, absent on a fresh instance.
  (DOC 3)
- [ ] **E4** Stale lines: spec 002 `ctx.ai`, "Next step: secrets.extension_secrets", "migrations on
  docker compose up"; SDK comment on `ctx.secrets`; skill mentions "data chat"; spec 000 terminal 2 GB;
  `ext.mjs` / pre-commit mention the `llm` container. (DOC 4, ARCH)
- [ ] **E5** `ext new --from onefile:` copies a template missing Beni, languages and `__tile`. (DOC 5)
- [ ] **E6** No manifest reference (limits live only in `extensions-lib.mjs`). (DOC 6)
- [ ] **E7** No single page for the `$shell` API, CSS classes, `sources.server.ts` example, how to call
  `/mcp` by hand; `profile` is a reserved argument; `readOnly` "Required" vs optional. (DOC 8-11, MCP)
- [ ] **E8** ext: `catalog.json` fields undocumented; `gym` has no `AGENTS.md`. (DOC 12)
- [ ] **E9** `docs/extension-layout.md` misses `sources.server.ts`, `web/routes/settings`, `__tile`.
  (DOC P3)

## 12. Needs you

- [ ] **N1** Copy `.env` into the password manager, `extensions/` and the latest dump off the NAS (B10).
- [ ] **N2** GitHub: ruleset on `main` of both repos (no force push, no deletion; required CI once T1
  runs) (D1c, T3).
- [ ] **N3** Off-machine backup target (B11).
- [ ] **N4** Archive the legacy repo `piotr-liszka/assistant` so no thread reads it. (ARCH)
- [ ] **N5** Tailscale admin: remove the stale serve entries on 8443-8445 (502). (memory)
