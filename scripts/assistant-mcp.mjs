#!/usr/bin/env node
/**
 * MCP server "assistant" (spec 005): gives Claude (Remote Control, or `claude` in the terminal) the
 * tools of every installed extension, read live from the web app's /api/claude. A tool is named
 * <extension>__<tool>, e.g. health__overview, gym__read_data; every tool takes an optional `profile`
 * (default: the app's default profile). New extensions show up without restarting anything.
 *
 * Env: ASSISTANT_URL (default http://web:3000), CLAUDE_TOOLS_TOKEN (same value as the web container).
 * Plain Node, no dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0.
 */
import { createInterface } from 'node:readline';

const BASE = (process.env.ASSISTANT_URL ?? 'http://web:3000').replace(/\/$/, '');
const TOKEN = process.env.CLAUDE_TOOLS_TOKEN ?? '';
const SEP = '__';

async function api(method, body, query = '') {
  const res = await fetch(`${BASE}/api/claude${query}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data;
}

const withProfile = (schema) => ({
  ...schema,
  type: 'object',
  properties: { ...(schema.properties ?? {}), profile: { type: 'string', description: 'Profile id; default: the main profile' } }
});

async function listTools() {
  const { extensions, profiles } = await api('GET');
  const tools = [
    {
      name: 'extensions',
      description:
        'The apps installed in the assistant (extensions), their data scope, tools and languages, the profiles, ' +
        "and the app's languages (every extension must be translated into each; spec 007). " +
        'Start here to find where data lives.',
      inputSchema: { type: 'object', properties: { profile: { type: 'string' } } }
    }
  ];
  for (const e of extensions)
    for (const t of e.tools)
      tools.push({ name: `${e.id}${SEP}${t.name}`, description: `[${e.name}] ${t.description}`, inputSchema: withProfile(t.input) });
  return { tools, profiles };
}

async function callTool(name, args = {}) {
  const { profile, ...rest } = args;
  if (name === 'extensions') return api('GET', null, profile ? `?profile=${encodeURIComponent(profile)}` : '');
  const i = name.indexOf(SEP);
  if (i < 1) throw new Error(`unknown tool ${name}`);
  const out = await api('POST', { extension: name.slice(0, i), tool: name.slice(i + SEP.length), arguments: rest, profile });
  return out.result;
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (initialized, cancelled)
  try {
    let result;
    if (method === 'initialize')
      result = {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'assistant', version: '1.0.0' },
        instructions:
          "A self-hosted assistant. Each extension (app) holds one kind of data: call `extensions` first, " +
          'then the extension tools. Prefer reading before writing; writes change what the apps show.'
      };
    else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: (await listTools()).tools };
    else if (method === 'tools/call') {
      try {
        const out = await callTool(params.name, params.arguments ?? {});
        result = { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] };
      } catch (e) {
        result = { content: [{ type: 'text', text: String(e.message ?? e) }], isError: true };
      }
    } else return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${method}` } });
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e.message ?? e) } });
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  handle(msg);
});
