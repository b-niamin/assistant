#!/usr/bin/env node
/**
 * Gives Codex what Claude gets from .mcp.json: the `assistant` MCP server (the apps' data, spec 005) and
 * the in-app browser. Codex reads MCP servers only from ~/.codex/config.toml, so the entrypoint runs this
 * before starting it. It rewrites only its own marked blocks; whatever else is in the file stays.
 *
 * Also turns Codex's own sandbox off: it needs user namespaces (bubblewrap), which a container does not
 * get, so every command failed. This container is the sandbox (no docker socket, no .env), as for Claude.
 * A `sandbox_mode` already in the file wins.
 *
 * Without the sandbox, approvals do the guarding: `approval_policy = "on-request"` (unless the file sets
 * one) and the execpolicy rules in /usr/local/lib/beni.rules, copied to ~/.codex/rules/beni.rules, make
 * Codex ask the owner before a critical command (a push, a recursive delete, raw SQL...), as
 * beni-guard.mjs does for Claude.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME ?? '/home/claude';
const dir = process.env.CODEX_HOME || path.join(HOME, '.codex');
const file = path.join(dir, 'config.toml');
const BEGIN = '# >>> beni (managed, rewritten on every start)';
const END = '# <<< beni';
const OURS = ['mcp_servers.assistant', 'mcp_servers.browser'];

let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
// Our earlier blocks.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
text = text.replace(new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}\\n?`, 'g'), '');
// The same servers added by hand (`codex mcp add assistant ...`) would be duplicate tables.
const lines = text.split('\n');
const kept = [];
let skipping = false;
for (const line of lines) {
  const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (header) skipping = OURS.some((t) => header[1] === t || header[1].startsWith(`${t}.`));
  if (!skipping) kept.push(line);
}
text = kept.join('\n').trim();

const firstTable = text.search(/^\s*\[/m);
const topLevel = firstTable === -1 ? text : text.slice(0, firstTable);
const topKeys = [
  /^\s*sandbox_mode\s*=/m.test(topLevel) ? '' : 'sandbox_mode = "danger-full-access"\n',
  /^\s*approval_policy\s*=/m.test(topLevel) ? '' : 'approval_policy = "on-request"\n'
].join('');
const top = topKeys ? `${BEGIN}\n${topKeys}${END}\n` : '';
const tables = `${BEGIN}
[mcp_servers.assistant]
command = "node"
args = ["/workspace/scripts/assistant-mcp.mjs"]
env_vars = ["CLAUDE_TOOLS_TOKEN", "ASSISTANT_URL", "DEFAULT_PROFILE"]

[mcp_servers.browser]
command = "playwright-mcp"
args = ["--cdp-endpoint", "http://localhost:9222"]
${END}
`;

mkdirSync(dir, { recursive: true });
writeFileSync(file, `${top}${text ? `${text}\n\n` : ''}${tables}`);

const RULES = process.env.BENI_CODEX_RULES ?? '/usr/local/lib/beni.rules';
if (existsSync(RULES)) {
  mkdirSync(path.join(dir, 'rules'), { recursive: true });
  copyFileSync(RULES, path.join(dir, 'rules', 'beni.rules'));
}
