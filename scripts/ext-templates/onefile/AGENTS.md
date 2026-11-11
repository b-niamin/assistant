# AGENTS.md ({{id}} onefile extension)

This extension is ONE self-contained HTML file (`app.html`), built by the rules of One File Apps
(github.com/b-niamin/onefile-apps, ARTIFACTS-DEVELOPMENT.md): no external requests, inline CSS/JS, strict
CSP meta, phone-first, light + dark, English and Polish.

How the shell runs it (spec 002): in an iframe sandboxed without allow-same-origin, at `/{{id}}`.
`localStorage` is a shim the shell pre-fills and saves to the database (`core.extension_kv`, scope
`{{scope}}`), so keep ALL state in localStorage under a few keys; `sessionStorage` is memory only.
There is no network (connect-src 'none') and no access to the shell.

The same file still works on its own (browser, claude.ai artifact) with real localStorage, so it can be
contributed back to onefile-apps. Keep it that way.

Dashboard tile (optional, spec 003): whenever the data changes, write a summary for the home page:
`localStorage.setItem('__tile', JSON.stringify({ kpis: [{ label: 'Streak', value: 12, unit: 'days' }],
series: { kind: 'bars', hue: 'green', caption: 'last 14 days', points: [{ label: 'Mon', value: 4 }] } }))`.
The shell renders it as text (no HTML), max 2 kpis, 90 points, 60-character strings; links only to `/...`.
Outside the shell the key is just ignored.

Look (required): inside the shell the iframe gets the shell's tokens (`--page`, `--surface`, `--ink`,
`--accent`, `--space-*`, ...; `@layer assistant`) and `<assistant-beni mood="steady" size="40">`, Beni the
mascot. Style only with `var(--token, fallback)`, put Beni in the header and empty states, and drop any
own palette or fonts. Outside the shell the fallbacks apply and the element stays empty.

Languages (required, spec 007): the app speaks every language of the assistant (System settings ->
Language). Its own UI carries the translations inside the HTML; list them in `extension.json`
`"languages": ["en", "pl"]`. Inside the shell `window.assistantLang` is the page's language: use it over
the app's own guess (navigator.language). Its name and description are translated in `i18n/<lang>.json`
(English text -> translation).

Tools for the AI (required, spec 005): `web/tools.server.ts` gives Claude a read-only `overview` (the
app's data summed up in plain fields, from `ctx.kv`, the same localStorage) and one tool per write that
keeps the app's data format. The shell adds raw `read_data` / `write_data`; `ext check` warns without them.

Check after a change: `node scripts/ext.mjs check {{id}}` in the shell repo root, then open `/{{id}}`.
`extensions/` is this instance's own folder (git-ignored in the assistant repo, kept by the daily backup):
nothing to commit. Settings from its panel in System settings arrive as `window.assistantSettings`
(read-only). Reference: docs/extensions.md in the shell repo.
