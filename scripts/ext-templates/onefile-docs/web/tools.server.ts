/**
 * Tools for the AI (spec 005): what Claude (the claude.ai connector, or Claude Code and Codex in the
 * terminal) can do with {{id}}, as `{{id}}__<tool>`. The shell adds `read_data` and `write_data` (raw
 * localStorage keys). The contract: a read-only `overview` that sums up what the app holds now in plain
 * fields, and one tool per write that keeps the app's data format (it reads it back on the next open).
 * ctx.kv is the app's localStorage, as the shell saves it (scope {{scope}}).
 */
import type { ExtTool } from '$shell';

/** The app's state key. The key app.html keeps its state under (see its localStorage calls). */
const KEY = '{{id}}.v1';

const load = async (kv: { get(k: string): Promise<string | null> }) => {
  try {
    return JSON.parse((await kv.get(KEY)) ?? 'null');
  } catch {
    return null;
  }
};

export const tools: ExtTool[] = [
  {
    name: 'overview',
    title: 'Overview',
    readOnly: true,
    description: 'What {{name}} holds now. Summarise the data: describe its fields here.',
    input: { type: 'object', properties: {} },
    run: async (_args, ctx) => ({ data: await load(ctx.kv) })
  }
];
