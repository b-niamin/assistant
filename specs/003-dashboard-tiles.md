# 003 Dashboard tiles

The home page (`/`) is a dashboard: one grid of tiles contributed by the installed extensions, plus a
few tiles the shell owns (Terminal). A tile shows one or two key numbers, optionally a small chart or a
short list, and links to the extension.

## Contract

A native extension may ship `web/tiles.server.ts`:

```ts
import type { ExtTile } from '$shell';

export const tiles: ExtTile[] = [
  {
    id: 'running-week',            // [a-z0-9-], unique in the extension
    title: 'Running',
    size: 'md',                    // sm: numbers only | md: numbers + chart (default) | lg: two columns
    load: (ctx) => ctx.db(async (sql) => ({
      kpis: [{ label: 'This week', value: 25.5, unit: 'km', delta: -9.4 }, { label: 'Runs', value: 3 }],
      series: { kind: 'bars', unit: 'km', hue: 'blue', caption: 'last 8 weeks', points: [{ label: 'W45', value: 25.5 }] }
    }))
  }
];
```

`load` gets the same `ExtensionContext` as the extension's pages: DB role `ext_<id>`, `dataProfileId`
(profile or shared scope), `kv`. It returns **TileData** (types in `$shell`):

| Field | Meaning |
|---|---|
| `kpis` | up to 2 figures `{label, value: number\|null, unit?, format?: 'number'\|'duration', digits?, delta?, better?: 'up'\|'down', status?: {label, tone}}`. The first is the big one. A delta is coloured only when `better` is set. |
| `series` | `{kind: 'line'\|'bars', points: {label, value\|null}[], unit?, hue?, caption?}`; up to 90 points. Hidden on `sm` tiles. |
| `list` | up to 5 `{label, meta?}` rows (agenda, due cards) |
| `empty` | `{message, action?: {label, href}}`: nothing to show yet and how to fix it |
| `href` | deep link, only inside the extension's own path |
| `note` | small "as of" line |

At most 4 tiles per extension. `npm run gen` writes `src/lib/extensions/generated/tiles.server.ts`
(lazy imports of each `tiles.server.ts`) through `generateTiles()` in `scripts/extensions-lib.mjs`.

**Onefile apps** opt in by writing their tile as JSON to
`localStorage['__tile']`; it is rendered as an `md` tile. The shim stores it in
`core.extension_kv` and the dashboard reads it. Without it, the app gets a plain card.

## Why data, not components

- No extension markup or script runs on the home page: a buggy or hostile extension cannot restyle,
  break or read the rest of the dashboard. Onefile `__tile` JSON is untrusted and goes through the same
  validator.
- `normalizeTile()` (`src/lib/extensions/tiles.ts`) clamps everything: 2 kpis, 90 points, 5 list rows,
  60-character strings, control characters stripped, hues from the fixed palette only, links only to
  same-origin paths (`/x`, never `//host` or `javascript:`). It never throws.
- Every tile looks like part of one system (specs/001): history in `--axis`, the latest point or bar in
  the tile's hue, deltas with an arrow and a sign, status as dot + word, values in the accessible label.

## Loading

`dashboardFor()` (`src/lib/extensions/dashboard.server.ts`) builds the list for the viewing profile
(visibility and scope as in spec 002). Each tile's data is a promise that SvelteKit streams: the grid
paints at once with skeletons, every tile has a 2.5 s timeout and its own try/catch, so a slow or broken
extension shows "Unavailable" in its tile only (the error goes to `/logs/web.log`).

## Tiles today

| Extension | Tiles |
|---|---|
| Training & Health (profile) | Readiness & HRV (score, readiness band, HRV 14-day line), Running (this week's km vs the 4-week average, runs, 8 weekly bars), Resting heart rate (30-day line), Sleep (14-day line) |
| Home (Home Assistant, shared) | placeholder: connect in System settings |
| Calendar (shared) | placeholder: connect in System settings |
| Learning (profile) | placeholder: create a deck |

The running delta is neutral on purpose: a week in progress is always behind a full week.

## Layout per profile

"Arrange" on the dashboard edits this profile's tile order and hides tiles (`core.dashboard_layout`,
`core.dashboard_layout`, keyed by tile key such as `health:readiness`). Tiles without a row (a newly installed
extension) come after the placed ones in default order. No unlock needed: it changes only the viewer's
profile.

## Next

- Size override and drag to reorder on the grid itself.
- Real Home Assistant (indoor temperature, today's energy as bars), calendar (next five events as a
  list) and learning (cards due, streak) tiles once those extensions exist.
