/**
 * Checks a tool call's arguments against the tool's `input` schema before `run` (audit C9), so a tool
 * gets what it declared and a client gets one clear message naming every wrong field. A small subset of
 * JSON Schema, the part the tools use: type (also a list, with "null"), enum, required, properties,
 * items, minimum/maximum, minLength/maxLength, minItems/maxItems, pattern, oneOf/anyOf. Keywords it
 * does not know pass, and so do properties the schema does not list.
 */
import type { ToolSchema } from './tools';

type Schema = Record<string, unknown>;

/** A wrong call, as opposed to a tool that broke: the MCP answer says "invalid arguments" with the list. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = []
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v;

function check(v: unknown, s: Schema, at: string, out: string[]): void {
  if (!s || typeof s !== 'object') return;
  const here = at || 'arguments';
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = s[key];
    if (Array.isArray(branches) && branches.length) {
      const ok = branches.some((b) => {
        const sub: string[] = [];
        check(v, b as Schema, at, sub);
        return sub.length === 0;
      });
      if (!ok) out.push(`${here}: does not match any allowed form`);
    }
  }
  if (s.type !== undefined) {
    const want = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
    const got = typeOf(v);
    if (!want.includes(got) && !(got === 'integer' && want.includes('number'))) {
      out.push(`${here}: must be ${want.join(' or ')}, got ${got}`);
      return;
    }
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => e === v)) out.push(`${here}: must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) out.push(`${here}: must be at least ${s.minimum}`);
    if (typeof s.maximum === 'number' && v > s.maximum) out.push(`${here}: must be at most ${s.maximum}`);
  }
  if (typeof v === 'string') {
    if (typeof s.minLength === 'number' && v.length < s.minLength) out.push(`${here}: must be at least ${s.minLength} characters`);
    if (typeof s.maxLength === 'number' && v.length > s.maxLength) out.push(`${here}: must be at most ${s.maxLength} characters`);
    if (typeof s.pattern === 'string') {
      let re: RegExp | null = null;
      try {
        re = new RegExp(s.pattern, 'u');
      } catch {
        re = null;
      }
      if (re && !re.test(v)) out.push(`${here}: must match ${s.pattern}`);
    }
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === 'number' && v.length < s.minItems) out.push(`${here}: needs at least ${s.minItems} items`);
    if (typeof s.maxItems === 'number' && v.length > s.maxItems) out.push(`${here}: takes at most ${s.maxItems} items`);
    if (s.items && typeof s.items === 'object') v.forEach((x, i) => check(x, s.items as Schema, `${here}[${i}]`, out));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of Array.isArray(s.required) ? (s.required as string[]) : [])
      if (o[r] === undefined) out.push(`${at ? at + '.' : ''}${r}: is required`);
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const [k, sub] of Object.entries(props)) if (o[k] !== undefined) check(o[k], sub, at ? `${at}.${k}` : k, out);
  }
}

/** The problems with `args` under `schema`; empty when they fit. */
export function argumentProblems(schema: ToolSchema | undefined, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (schema) check(args, schema, '', out);
  return out.slice(0, 20);
}

/** Throws a ToolError naming every problem. */
export function checkArguments(tool: string, schema: ToolSchema | undefined, args: Record<string, unknown>): void {
  const problems = argumentProblems(schema, args);
  if (problems.length) throw new ToolError(`invalid arguments for ${tool}: ${problems.join('; ')}`, problems);
}
