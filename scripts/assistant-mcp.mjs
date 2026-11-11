#!/usr/bin/env node
/**
 * MCP server "assistant" for the AI CLIs in the terminal container (spec 005): Claude Code (.mcp.json) and
 * Codex (~/.codex/config.toml) start it over stdio. It only relays: every JSON-RPC line goes to the web
 * app's /mcp with the stack's CLAUDE_TOOLS_TOKEN, and the answer comes back as a line. The tools are the
 * same ones the Claude connector gets: `extensions` and `<extension>__<tool>` for every installed app.
 *
 * Env: ASSISTANT_URL (default http://web:3000), CLAUDE_TOOLS_TOKEN (same value as the web container).
 * Plain Node, no dependencies.
 */
import { createInterface } from 'node:readline';

const URL_ = `${(process.env.ASSISTANT_URL ?? 'http://web:3000').replace(/\/$/, '')}/mcp`;
const TOKEN = process.env.CLAUDE_TOOLS_TOKEN ?? '';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function relay(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const id = Array.isArray(msg) ? null : (msg?.id ?? null);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
      body: line,
      signal: AbortSignal.timeout(90_000)
    });
    if (res.status === 202) return;
    const text = await res.text();
    if (res.status === 401) throw new Error('the web app refused CLAUDE_TOOLS_TOKEN (missing in this container, or different from web\'s)');
    try {
      send(JSON.parse(text));
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
  } catch (e) {
    if (id !== null) send({ jsonrpc: '2.0', id, error: { code: -32000, message: `assistant: ${e.message ?? e}` } });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) relay(line);
});
