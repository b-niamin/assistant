# 001 Design system

The web app follows one deliberate visual system instead of framework defaults. It adds no runtime
dependencies: tokens live in `apps/web/src/app.css`, charts are hand-drawn SVG.

## Source

Charts, figures and colour follow the **dataviz** skill method (validated palette, form-before-colour,
fixed mark specs, hover layer, table twin). The palette is that skill's reference instance; slot 1 blue
was run through its validator against both chart surfaces (`#fcfcfb` light, `#1a1a19` dark) and passes.

## Tokens (`app.css`)

| Role | Tokens |
|---|---|
| Surfaces | `--page` (plane), `--surface` (cards, chart surface), `--surface-2` (wells, segmented control) |
| Ink | `--ink` primary, `--ink-2` secondary, `--ink-3` muted (axes, meta) |
| Chart chrome | `--grid` hairline gridlines, `--axis` baseline and de-emphasis lines, `--ring` 1px card border |
| Data | `--accent` (single series), `--accent-wash` (10 % area fill), `--accent-ink` (links, text-safe step) |
| Status | `--good`, `--warning`, `--serious`, `--critical` (dots); `--good-ink` for good text |
| Metric hues | `--hue-blue/orange/aqua/yellow/magenta/green/violet/red` (validated categorical slots, own dark steps); `--brand` = Beni's orange |
| Spacing | `--space-1..7` = 4, 8, 12, 16, 24, 32, 48 px |

Dark mode is its own set of steps (not an inversion), applied by `prefers-color-scheme` and by
`data-theme="dark"`; `data-theme="light"` forces light.

## Rules

- One system sans everywhere, including the hero figure. Proportional figures for big standalone
  numbers; `tabular-nums` only in tables and axis ticks.
- Form first: a single current value is a **stat tile** (label, value, delta vs 7-day average,
  14-day sparkline); the one number the page leads with is the **hero figure** (Training readiness).
  A trend is a single-series line chart.
- Line charts: 2px line, 10 % wash, solid 1px gridlines, round ticks (durations on whole/half hours),
  the latest value labelled at the line end, crosshair + tooltip on hover and arrow keys, and a
  "Show as table" twin. Gaps in data stay gaps.
- Sparklines bridge gaps (they are a trend glyph); history in `--axis`, latest point in `--accent`.
- Status colour is never alone: always a dot plus a word (`.status good|warning|serious|critical`).
  Deltas carry an arrow and a sign besides colour; tone follows the metric's `goodWhen`.
- Text never wears a series colour. Bars and lines carry colour; labels use ink tokens.
- Controls: range presets are a segmented control built from links (works without JS); one quiet
  style for select/input/button.

## Colour per metric

Each metric owns one hue (`modules/health/look.ts`): readiness orange, sleep violet, HRV aqua, Body
Battery green, resting HR red, stress magenta, steps blue. The hue shows on the metric's icon badge,
its sparkline's latest point and its trend line, so the colour always means the same thing. Training
load bars are orange (effort). Text keeps ink tokens.

## Mascot: Beni

`lib/Mascot.svelte` is a jelly-bean runner, pure SVG + CSS. Its mood follows today's
Training Readiness (`lib/mascot.ts`): charged (75+, hops and sparkles), steady (50-74, breathes),
tired (25-49, half-closed eyes, sways), asleep (<25, closed eyes, floating z's), idle (no data). It
says one short line per mood, fixed for the day. Pupils follow the pointer; a click makes it bounce.
A small decorative Beni is the brand mark in the header; the login page shows a charged one.

Beni is the app's face everywhere, so a screen without data never feels broken:

- **Icons**: `static/favicon.svg` (cropped, no shadow), `apple-touch-icon.png` and `icon-192/512.png`
  (Beni on a warm tile) via `manifest.webmanifest`; theme colour is Beni's orange. `static/beni.svg` is
  the full static Beni, used by the README. Regenerate the PNGs from the SVG if Beni's look changes.
- **Dashboard**: Beni greets next to the greeting, mood by time of day (`moodForHour`: asleep before
  6, charged in the morning, steady until 22, tired late).
- **Empty and error states**: a small decorative Beni (idle for "no data yet", tired for "unavailable",
  asleep for a closed terminal) sits beside the message: dashboard tiles, the empty dashboard, the
  settings extension list, the terminal veil, health charts, and `+error.svelte` (404 and errors).
- Extensions reuse it through `$shell/ui` (`Mascot`, `moodFor`, `moodForHour`, `accessoryFor`).

### What Beni wears

Beni dresses for what you are doing. The drawings are SVG fragments in `lib/beni-accessories.ts`, shared
by `Mascot.svelte` and `<assistant-beni>`, so every Beni in the app (and in onefile apps) can wear them:

| Accessory | Where |
|---|---|
| `headband` (the sweatband) | sport: gym, workouts, running |
| `stethoscope` | health |
| `book` | learning, reading |
| `wrench` | System settings |
| `glasses` | the terminal; code, data, reports |
| `headphones` | music, podcasts, calls |
| `chef-hat` | food, recipes, diet, shopping |
| `pencil` (in hand) | notes, calendar, to-dos, habits |
| `bulb` | smart home, ideas |
| `coin` | money, budget |
| `umbrella` | weather |
| `party-hat` | celebrations: a record, a goal hit |
| `nightcap` | sleep; any asleep Beni with nothing else on |

`accessoryFor(pathname, extensions)` picks it from the page: the dashboard has none, `/settings` the
wrench, `/<id>` the extension's manifest `"accessory"` or, without one, a
guess from its id and name (`guessAccessory`). Every `Mascot` without an `accessory` prop follows the
page; dashboard tiles dress Beni for the app they come from, "Extend the system" for each catalog entry.
Pass `accessory="party-hat"` (or `"none"`) to choose yourself.

**Eyes covered.** While a password field has focus (`type="password"`, or one marked with
`autocomplete="*-password"` / `data-secret`), every Beni on the page covers its eyes with both hands; when
the field is revealed (type flipped to `text`), it peeks through one. `lib/beni-watch.svelte.ts` holds the
one document-wide listener; `shy` forces it (`true`, `"peek"`, `false`).

## Extensions wear this look (required)

Every extension, however it was inspired, uses this layout and has Beni: the tokens above (light and
dark), the shell's classes, and Beni in its header and in every empty or error state, with a mood that
fits. The source's own palette, fonts and logo are dropped.

- Native extensions render inside the shell, so `app.css` and `$shell/ui` are there already.
- Onefile apps run in a sandboxed iframe that cannot load the shell's files. The host injects
  (`src/lib/extensions/theme.ts`) the token blocks of `app.css` as `@layer assistant`, so the app's own
  unlayered rules still win, and defines `<assistant-beni mood size label accessory shy>`: Beni as a custom
  element in shadow DOM, with the same moods (breathing, hop, sway, closed eyes; still under reduced
  motion). Without `accessory` it wears the app's own (`window.assistantBeni.accessory`), and it covers
  its eyes on password fields by itself.
- `node scripts/ext.mjs check` prints `look:` warnings: Beni missing, no shell tokens, raw hex in native
  pages. A new extension must have none; older ones are warned only.

## Motion

- Cards rise in on load, staggered 55 ms (`.rise` with `--i`).
- The readiness number counts up; sparklines and the trend line draw in, the wash fades in after.
- Training load bars grow from the left; tiles lift 2 px on hover.
- Only `transform` and `opacity` (plus SVG dash offset) are animated, so it stays cheap.
- `prefers-reduced-motion: reduce` turns every animation off, including Beni and the count-up.

## Dock and terminal

The header reads `[Beni] [extensions nav] <spacer> [update state] [lock] [avatar]`. The avatar
(`lib/user-menu/UserMenu.svelte`) is a pill with the profile's initials in its own hue (`hueFor`) and, on wide
screens, its name. Its menu leads to Profile settings, Claude and MCP and System settings, switches profiles,
picks the theme (Light, Dark, System as icons: the `theme` cookie, written by the server as `data-theme` on
`<html>` so nothing flashes) and the language for this browser, and logs out. The cookies are set in
`lib/user-menu/prefs.ts`, shared with Profile settings -> Appearance (which also has reduced motion).

## Settings

One shell for the profile's and the system's settings (`routes/settings/+layout.svelte`): a sidebar of
sections grouped You / Apps and people / AI / This server (`lib/settings/nav.ts`), each a page of its own,
with a dot where something needs attention (`lib/server/settings-status.ts`: updater, backups, worker,
Claude connector, a failed build). The overview (`/settings`) shows the same states as tiles, the common tasks
and the people at home. On a phone the overview is the list, and every other page starts with a way back.
A page starts with `PageHead` (title, one line, an action); cards, rows and choice cards come from the shell.

## First run

`install.sh` asks nothing and prints an address and a setup code. The wizard at `/setup` (`lib/setup/steps.ts`)
has four steps with a progress row and Beni: you (code, password, name, language), apps (catalog, installed in
the dock's terminal), updates and Claude (update mode, Claude connector) and done (what is next).

The lock (`lib/dock/LockMenu.svelte`) shows whether this session is unlocked (the app password typed again,
10 minutes, the same unlock as System settings). Locked, a closed padlock, and there is no terminal on any
page; a click opens a small password prompt under it. Unlocked, an open violet padlock, and the dock
appears at the bottom; a click locks again and closes the terminal. A terminal that is connected stays
when the 10 minutes run out, until the lock is clicked. Left of the lock, a chip appears only when the
host's updater needs attention: Updating, Update, Restart needed, Update interrupted, Updates stopped
(links to System settings -> Updates). The state comes from `GET /dock` every 30 s.

The dock (`lib/dock/Dock.svelte`) is a 40 px bar fixed to the bottom with the terminal toggle. Expanding
it opens the app's only terminal (created on first open, kept connected while collapsed, open or closed
remembered per browser). A page that wants the terminal while locked (a Sign in button, Build it) opens
the lock's password prompt first, then runs its command.
Pages hand it work: `runInDock` runs a command in a new tmux window ("Extend the system", the sign-ins
in System settings → Terminal and AI), `askAgent` starts the default AI CLI there with a prompt as its first
message (`claude '<prompt>'` or `codex '<prompt>'`) for "Build it" and "Install". An extension panel's
"Update" uses `draftForAgent`: `scripts/agent-draft.sh` starts the CLI, waits until it has put the terminal
in raw mode (plus 1.5 s for its input box), then types `Update extension <name> (extensions/<id>): ` into
it with `tmux send-keys`, without Enter, for the owner to finish. The default AI is picked in System settings → Terminal and AI
(`secrets.app_config` key `default_agent`, served by `GET /dock`); when only the other CLI is signed in,
that one starts.

The terminal is a dark window in both themes, like a code block in an editor.

- Font: JetBrains Mono (variable), bundled in `lib/terminal/fonts` (OFL) because the CSP allows no font
  CDN. ANSI colours are the categorical hues, lifted for a dark background (`lib/terminal/theme.ts`);
  the cursor is Beni's orange. `services/terminal/tmux.conf` gives tmux a matching quiet status line.
- Window chrome: connection status (dot plus word, pulsing while connecting), session name and size,
  then text size A−/A+ (remembered per device), reconnect and full screen. When the socket is not open
  a veil over the screen says why and offers Reconnect; the page reconnects by itself when a phone
  wakes the tab.
- Sign-ins live in System settings → Terminal and AI: Claude Code, Codex and GitHub CLI with their state and
  a "Sign in" button that runs the command in the dock.
- Touch key bar (`lib/terminal/keys.ts`) on coarse pointers and narrow windows: Esc, Tab, Shift+Tab,
  sticky Ctrl, ^C, arrows (application cursor mode aware) and a few symbols phone keyboards hide.
  In full screen the window follows the visual viewport, so the bar stays above the keyboard.
