/**
 * Tools for the AI (spec 005): how Claude (the claude.ai connector, or Claude Code and Codex in the
 * terminal) reads and changes an extension's data. Every extension gets generic tools from the shell
 * and adds its own in web/tools.server.ts (`export const tools: ExtTool[]`), native and onefile alike.
 * The shell serves them all as one MCP server at /mcp: `<extension>__<tool>`.
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
  /** A short human title ("Log a workout"); clients show it when asking to allow the tool. */
  title?: string;
  /** What it does and returns, written for the AI: when to call it, what the arguments mean. */
  description: string;
  input?: ToolSchema;
  /** Only reads: clients may run it without asking. Default false, so every write is declared as one. */
  readOnly?: boolean;
  /** Deletes or overwrites data the owner made (not just adds to it). Default false. */
  destructive?: boolean;
  run(args: Record<string, unknown>, ctx: ExtensionContext): unknown | Promise<unknown>;
}

export interface ToolInfo {
  name: string;
  title: string;
  description: string;
  input: ToolSchema;
  readOnly: boolean;
  destructive: boolean;
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

export const infoOf = (t: Pick<ExtTool, 'name' | 'title' | 'description' | 'input' | 'readOnly' | 'destructive'>): ToolInfo => ({
  name: t.name,
  title: String(t.title ?? t.name.replace(/_/g, ' ')).slice(0, 80),
  description: String(t.description ?? '').slice(0, 2000),
  input: t.input && t.input.type === 'object' ? t.input : EMPTY_SCHEMA,
  readOnly: t.readOnly === true,
  destructive: t.readOnly !== true && t.destructive === true
});

/**
 * What `ext check` and the tool list warn about in an extension's own tools (spec 005): the contract every
 * extension follows so the AI can use it without reading its code.
 */
export function toolProblems(list: ExtTool[]): string[] {
  const out: string[] = [];
  if (!list.some((t) => t.name === 'overview' && t.readOnly === true))
    out.push('no read-only `overview` tool (one call that sums up what the app holds now)');
  for (const t of list) {
    if (String(t.description ?? '').trim().length < 20) out.push(`${t.name}: describe it for the AI (what it does and returns)`);
    if (t.readOnly === undefined) out.push(`${t.name}: say readOnly: true or false`);
  }
  return out;
}

/** Rows and values must survive JSON: dates as ISO strings, bigints as strings. */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null');
}
