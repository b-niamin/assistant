/**
 * Tools for Claude (spec 005), server side: lists every extension's tools and runs one as a profile.
 * Generic tools come from the shell, so any extension is usable by Claude without extra code:
 *   native  -> describe (tables and columns of its schema), query (read-only SQL as its own role)
 *   onefile -> read_data (its saved localStorage), write_data (set or remove one key)
 * A native extension adds its own tools (e.g. writes with validation) in web/tools.server.ts.
 */
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import type { ExtensionContext } from '$lib/sdk';
import { kvAll, kvApply, validatePatch } from './kv.server';
import { allExtensions, visibleTo } from './registry.server';
import { contextFor } from './runtime.server';
import { TOOL_MODULES } from './generated/tools.server';
import { infoOf, jsonSafe, validTools, type ExtTool, type ToolInfo } from './tools';
import type { ExtensionInfo } from './types';

const MAX_ROWS = 500;
const schemaOf = (id: string) => id.replace(/-/g, '_');

function nativeGeneric(ext: ExtensionInfo): ExtTool[] {
  const schema = schemaOf(ext.id);
  return [
    {
      name: 'describe',
      description:
        `Tables and columns of the "${schema}" schema of ${ext.name}. ` +
        (ext.scope === 'shared' ? 'Data is shared by all profiles.' : 'Rows belong to a profile: filter by profile_id.'),
      run: () =>
        db()`SELECT table_name, column_name, data_type
             FROM information_schema.columns WHERE table_schema = ${schema}
             ORDER BY table_name, ordinal_position`.then((rows) => {
          const tables: Record<string, string[]> = {};
          for (const r of rows) (tables[r.table_name] ??= []).push(`${r.column_name} ${r.data_type}`);
          return { extension: ext.id, schema, scope: ext.scope, tables };
        })
    },
    {
      name: 'query',
      description:
        `Read-only SQL (one SELECT) over the "${schema}" schema of ${ext.name}, run as the extension's own ` +
        `role. Returns up to ${MAX_ROWS} rows. Call describe first for the tables.`,
      input: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
      run: async (args) => {
        const text = String(args.sql ?? '').trim().replace(/;\s*$/, '');
        if (!text) throw error(400, 'sql is required');
        return db().begin('read only', async (sql) => {
          await sql.unsafe(`SET LOCAL statement_timeout = '15s'`);
          let rows: unknown[];
          if (env.EXTENSION_DB_ROLES === 'off') {
            // Local development against a database without the roles: plain query, single statement.
            rows = await sql.unsafe(text, [], { prepare: true });
          } else {
            // Not `SET LOCAL ROLE` + the raw text: a query could undo that role with set_config('role', ...)
            // and read core.sessions. ext_query.<schema> is a security-definer function owned by the
            // extension's role, where Postgres refuses any role change (db/extension-role.sql, spec 004).
            // sql('a.b') quotes each part: "ext_query"."<schema>".
            rows = (
              await sql<{ r: unknown }[]>`SELECT r FROM ${sql('ext_query.' + schema)}(${text}) AS r LIMIT ${MAX_ROWS + 1}`
            ).map((x) => x.r);
          }
          return { rows: jsonSafe(rows.slice(0, MAX_ROWS)), truncated: rows.length > MAX_ROWS };
        });
      }
    }
  ];
}

function onefileGeneric(ext: ExtensionInfo): ExtTool[] {
  const parse = (v: string) => {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  return [
    {
      name: 'read_data',
      description: `Everything ${ext.name} saved (its localStorage: key -> value, JSON values parsed).`,
      run: async (_a, ctx) => Object.fromEntries(Object.entries(await kvAll(ext, ctx.profileId)).map(([k, v]) => [k, parse(v)]))
    },
    {
      name: 'write_data',
      description:
        `Set one localStorage key of ${ext.name} (value is stored as given; pass JSON text for JSON values), ` +
        `or remove it with remove: true. Read the data first and keep its format: the app reads it back.`,
      input: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' }, remove: { type: 'boolean' } },
        required: ['key']
      },
      run: async (args, ctx) => {
        const key = String(args.key ?? '');
        const patch = validatePatch(args.remove === true ? { remove: [key] } : { set: { [key]: String(args.value ?? '') } });
        await kvApply(ext, ctx.profileId, patch);
        return { ok: true };
      }
    }
  ];
}

async function toolsOf(ext: ExtensionInfo): Promise<ExtTool[]> {
  const generic = ext.kind === 'onefile' ? onefileGeneric(ext) : nativeGeneric(ext);
  const loader = TOOL_MODULES[ext.id];
  if (!loader) return generic;
  try {
    const own = validTools((await loader()).tools, new Set(generic.map((t) => t.name)));
    return [...generic, ...own];
  } catch (e) {
    console.error(`tools: ${ext.id} failed to load:`, e instanceof Error ? e.message : e);
    return generic;
  }
}

export interface ExtensionTools {
  id: string;
  name: string;
  description: string;
  kind: ExtensionInfo['kind'];
  scope: ExtensionInfo['scope'];
  tools: ToolInfo[];
}

export async function listTools(profileId: string): Promise<ExtensionTools[]> {
  const exts = (await allExtensions()).filter((e) => visibleTo(e, profileId));
  return Promise.all(
    exts.map(async (e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      kind: e.kind,
      scope: e.scope,
      tools: (await toolsOf(e)).map(infoOf)
    }))
  );
}

export async function callTool(extensionId: string, name: string, args: unknown, profileId: string): Promise<unknown> {
  const ctx: ExtensionContext = await contextFor(extensionId, { locals: { profileId } as App.Locals });
  const tool = (await toolsOf(ctx.extension)).find((t) => t.name === name);
  if (!tool) throw error(404, `${extensionId} has no tool ${name}`);
  const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return jsonSafe(await tool.run(a, ctx));
}
