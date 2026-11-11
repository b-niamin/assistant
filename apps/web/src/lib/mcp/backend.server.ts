/**
 * The tools behind /mcp (spec 005): `extensions` plus every extension's tools as `<extension>__<tool>`,
 * for one connection's default profile. The tool list is read on every tools/list, so a new extension
 * shows up without a restart.
 */
import { error } from '@sveltejs/kit';
import { callTool, listTools } from '#lib/extensions/tools.server.ts';
import { languageSettings } from '#lib/server/languages.ts';
import { listProfiles } from '#lib/server/session.ts';
import type { McpBackend, McpTool } from './protocol';

export const SEP = '__';

const PROFILE_PROP = { type: 'string', description: 'Profile id (a person at home); default: the profile this connection uses' };

async function profileOf(v: unknown, fallback: string): Promise<string> {
  const id = typeof v === 'string' && v ? v : fallback;
  if (!(await listProfiles()).some((p) => p.id === id)) throw error(400, `unknown profile ${id}`);
  return id;
}

export function backendFor(defaultProfile: string): McpBackend {
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
          inputSchema: { type: 'object', properties: { profile: PROFILE_PROP } },
          annotations: { title: 'Apps and profiles', readOnlyHint: true, openWorldHint: false }
        }
      ];
      for (const e of await listTools(defaultProfile))
        for (const t of e.tools)
          tools.push({
            name: `${e.id}${SEP}${t.name}`,
            title: `${e.name}: ${t.title}`,
            description: `[${e.name}] ${t.description}`,
            inputSchema: { ...t.input, type: 'object', properties: { ...(t.input.properties ?? {}), profile: PROFILE_PROP } },
            annotations: { title: `${e.name}: ${t.title}`, readOnlyHint: t.readOnly, destructiveHint: t.destructive, openWorldHint: false }
          });
      return tools;
    },

    async callTool(name, args) {
      const { profile: p, ...rest } = args;
      const profile = await profileOf(p, defaultProfile);
      if (name === 'extensions') return { profile, profiles: await listProfiles(), languages: await languageSettings(), extensions: await listTools(profile) };
      const i = name.indexOf(SEP);
      if (i < 1) throw error(404, `unknown tool ${name}`);
      return callTool(name.slice(0, i), name.slice(i + SEP.length), rest, profile);
    }
  };
}
