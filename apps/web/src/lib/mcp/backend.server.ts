/**
 * The tools behind /mcp (spec 005): `extensions` plus every extension's tools as `<extension>__<tool>`.
 * The tool list is read on every tools/list, so a new extension shows up without a restart.
 *
 * Two callers, two rule sets:
 *   - the AI CLIs in the terminal (CLAUDE_TOOLS_TOKEN): every tool, any profile (`profile` argument);
 *   - a Claude connector connection (OAuth, from the internet): only the profile and apps of the MCP
 *     address it was approved on (endpoints.server.ts), writes only when that address allows them, and none of the raw tools (SQL `query`,
 *     `describe`, `read_data`, `write_data`): the overview and each app's own tools are the interface.
 * Every tools/call is logged in core.tool_calls (no arguments, no results).
 */
import { error } from '@sveltejs/kit';
import { callTool, listTools, type ExtensionTools } from '#lib/extensions/tools.server.ts';
import { languageSettings } from '#lib/server/languages.ts';
import { listProfiles } from '#lib/server/session.ts';
import { canWrite } from './oauth';
import { logToolCall, type GrantAccess } from './oauth.server';
import type { McpBackend, McpTool } from './protocol';

export const SEP = '__';

/** Generic tools of the shell that hand out raw data: terminal only. */
export const RAW_TOOLS = new Set(['query', 'describe', 'read_data', 'write_data']);

export type Caller = { kind: 'terminal'; profileId: string } | ({ kind: 'connector' } & GrantAccess);

const PROFILE_PROP = { type: 'string', description: 'Profile id (a person at home); default: the profile this connection uses' };

async function profileOf(v: unknown, fallback: string): Promise<string> {
  const id = typeof v === 'string' && v ? v : fallback;
  if (!(await listProfiles()).some((p) => p.id === id)) throw error(400, `unknown profile ${id}`);
  return id;
}

/** What a caller may see of the installed apps and their tools. */
export function visibleFor(caller: Caller, exts: ExtensionTools[]): ExtensionTools[] {
  if (caller.kind === 'terminal') return exts;
  const write = canWrite(caller.scope);
  return exts
    .filter((e) => !caller.extensions || caller.extensions.includes(e.id))
    .map((e) => ({ ...e, tools: e.tools.filter((t) => !RAW_TOOLS.has(t.name) && (write || t.readOnly)) }))
    .filter((e) => e.tools.length > 0);
}

export function backendFor(caller: Caller): McpBackend {
  const terminal = caller.kind === 'terminal';
  const withProfile = (props: Record<string, unknown> = {}) => (terminal ? { ...props, profile: PROFILE_PROP } : props);

  async function run(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { profile: p, ...rest } = args;
    // A connection acts for its own profile only; naming another one is refused, not ignored.
    if (!terminal && p !== undefined && p !== '' && p !== caller.profileId) throw error(403, 'this connection acts for one profile only');
    const profile = terminal ? await profileOf(p, caller.profileId) : caller.profileId;
    const visible = visibleFor(caller, await listTools(profile));
    if (name === 'extensions') {
      const profiles = (await listProfiles()).filter((x) => terminal || x.id === profile);
      return { profile, profiles, languages: await languageSettings(), extensions: visible };
    }
    const i = name.indexOf(SEP);
    if (i < 1) throw error(404, `unknown tool ${name}`);
    const ext = name.slice(0, i);
    const tool = name.slice(i + SEP.length);
    if (!visible.some((e) => e.id === ext && e.tools.some((t) => t.name === tool))) throw error(404, `unknown tool ${name}`);
    return callTool(ext, tool, rest, profile);
  }

  return {
    async listTools() {
      const tools: McpTool[] = [
        {
          name: 'extensions',
          title: 'Apps and profiles',
          description:
            'The apps installed in the assistant (extensions): what each holds, its data scope (per profile or ' +
            'shared), its tools and languages, plus the profiles (people at home) and the app\'s languages (every ' +
            'extension must be translated into each; spec 007). Start here to find where data lives.',
          inputSchema: { type: 'object', properties: withProfile() },
          annotations: { title: 'Apps and profiles', readOnlyHint: true, openWorldHint: false }
        }
      ];
      for (const e of visibleFor(caller, await listTools(caller.profileId)))
        for (const t of e.tools)
          tools.push({
            name: `${e.id}${SEP}${t.name}`,
            title: `${e.name}: ${t.title}`,
            description: `[${e.name}] ${t.description}`,
            inputSchema: { ...t.input, type: 'object', properties: withProfile(t.input.properties ?? {}) },
            annotations: { title: `${e.name}: ${t.title}`, readOnlyHint: t.readOnly, destructiveHint: t.destructive, openWorldHint: false }
          });
      return tools;
    },

    async callTool(name, args) {
      const started = Date.now();
      const log = (ok: boolean, err: string | null) =>
        logToolCall({
          source: caller.kind,
          grantId: terminal ? null : caller.grantId,
          endpoint: terminal ? null : caller.endpoint,
          client: terminal ? null : caller.client,
          profileId: caller.profileId,
          tool: name,
          ok,
          error: err,
          ms: Date.now() - started
        });
      try {
        const out = await run(name, args);
        await log(true, null);
        return out;
      } catch (e) {
        const msg = (e as { body?: { message?: string } })?.body?.message ?? (e instanceof Error ? e.message : String(e));
        await log(false, msg);
        throw e;
      }
    }
  };
}
