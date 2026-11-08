/**
 * Tools for Claude (spec 005): how Claude Remote reads and changes an extension's data. Every
 * extension gets generic tools from the shell; a native extension may add its own in
 * web/tools.server.ts (`export const tools: ExtTool[]`). The shell exposes them all through
 * /api/claude, and scripts/assistant-mcp.mjs turns that into an MCP server for Claude.
 */
import type { ExtensionContext } from '#lib/sdk/index.ts';

/** A JSON Schema object describing a tool's arguments. */
export interface ToolSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

export interface ExtTool {
  /** [a-z][a-z0-9_]*, at most 40 characters, unique within the extension. */
  name: string;
  /** What it does and returns, written for Claude. */
  description: string;
  input?: ToolSchema;
  run(args: Record<string, unknown>, ctx: ExtensionContext): unknown | Promise<unknown>;
}

export interface ToolInfo {
  name: string;
  description: string;
  input: ToolSchema;
}

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const EMPTY_SCHEMA: ToolSchema = { type: 'object', properties: {} };

/** Keep only well-formed tools; the first of a duplicated name wins. */
export function validTools(list: unknown, reserved: Set<string> = new Set()): ExtTool[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set(reserved);
  const out: ExtTool[] = [];
  for (const t of list as ExtTool[]) {
    if (!t || typeof t.run !== 'function' || typeof t.name !== 'string' || !TOOL_NAME_RE.test(t.name)) continue;
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out;
}

export const infoOf = (t: Pick<ExtTool, 'name' | 'description' | 'input'>): ToolInfo => ({
  name: t.name,
  description: String(t.description ?? '').slice(0, 2000),
  input: t.input && t.input.type === 'object' ? t.input : EMPTY_SCHEMA
});

/** Rows and values must survive JSON: dates as ISO strings, bigints as strings. */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null');
}
