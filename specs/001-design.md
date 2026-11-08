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

`lib/Mascot.svelte` is a jelly-bean runner in a sweatband, pure SVG + CSS. Its mood follows today's
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
- Extensions reuse it through `$shell/ui` (`Mascot`, `moodFor`, `moodForHour`).

## Extensions wear this look (required)

Every extension, however it was inspired, uses this layout and has Beni: the tokens above (light and
dark), the shell's classes, and Beni in its header and in every empty or error state, with a mood that
fits. The source's own palette, fonts and logo are dropped.

- Native extensions render inside the shell, so `app.css` and `$shell/ui` are there already.
- Onefile apps run in a sandboxed iframe that cannot load the shell's files. The host injects
  (`src/lib/extensions/theme.ts`) the token blocks of `app.css` as `@layer assistant`, so the app's own
  unlayered rules still win, and defines `<assistant-beni mood size label>`: Beni as a custom element in
  shadow DOM, with the same moods (breathing, hop, sway, closed eyes; still under reduced motion).
- `node scripts/ext.mjs check` prints `look:` warnings: Beni missing, no shell tokens, raw hex in native
  pages. A new extension must have none; older ones are warned only.

## Motion

- Cards rise in on load, staggered 55 ms (`.rise` with `--i`).
- The readiness number counts up; sparklines and the trend line draw in, the wash fades in after.
- Training load bars grow from the left; tiles lift 2 px on hover.
- Only `transform` and `opacity` (plus SVG dash offset) are animated, so it stays cheap.
- `prefers-reduced-motion: reduce` turns every animation off, including Beni and the count-up.

## Terminal (System settings → Terminal)

The in-app terminal is a dark window in both themes, like a code block in an editor.

- Font: JetBrains Mono (variable), bundled in `lib/terminal/fonts` (OFL) because the CSP allows no font
  CDN. ANSI colours are the categorical hues, lifted for a dark background (`lib/terminal/theme.ts`);
  the cursor is Beni's orange. `services/terminal/tmux.conf` gives tmux a matching quiet status line.
- Window chrome: connection status (dot plus word, pulsing while connecting), session name and size,
  then text size A−/A+ (remembered per device), reconnect and full screen. When the socket is not open
  a veil over the screen says why and offers Reconnect; the page reconnects by itself when a phone
  wakes the tab.
- Sign-in cards for Claude Code, Codex and GitHub CLI: status from the terminal's `/status` booleans
  (polled through `GET /settings/terminal/status` after a quick action) and a button that types and
  runs the command. On phones the button reads "Sign in" / "Run".
- Touch key bar (`lib/terminal/keys.ts`) on coarse pointers and narrow windows: Esc, Tab, Shift+Tab,
  sticky Ctrl, ^C, arrows (application cursor mode aware) and a few symbols phone keyboards hide.
  In full screen the window follows the visual viewport, so the bar stays above the keyboard.
