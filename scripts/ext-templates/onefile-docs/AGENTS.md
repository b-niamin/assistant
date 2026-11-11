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

Tools for the AI (required, spec 005): `web/tools.server.ts` gives Claude a read-only `overview` (the
app's data summed up in plain fields, from `ctx.kv`, the same localStorage) and one tool per write that
keeps the app's data format. The shell adds raw `read_data` / `write_data`; `ext check` warns without them.

Check after a change: `node scripts/ext.mjs check {{id}}` in the shell repo root, then open `/{{id}}`.
Commit it in the assistant repo, with `extensions/installed.json`. Settings from its panel in System
settings arrive as `window.assistantSettings` (read-only).
