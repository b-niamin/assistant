/**
 * The MCP server of the assistant (spec 005), protocol only: JSON-RPC 2.0 over Streamable HTTP, without
 * sessions or server-sent events (every request gets one JSON answer). Pure: the tools come from a
 * backend, so this is unit-tested without a database. /mcp (routes/mcp/+server.ts) wires it up.
 */

/** Newest first: the version a client asks for when we know it, else the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}

export interface McpBackend {
  listTools(): Promise<McpTool[]>;
  /** Throws for an unknown tool or bad arguments; the message goes back to the AI as a tool error. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export const SERVER_INFO = { name: 'assistant', title: 'Beni Assistant', version: '2.0.0' };
export const INSTRUCTIONS =
  'A self-hosted personal assistant made of apps (extensions); each app holds one kind of data (training, ' +
  'the gym log, the house...). Call `extensions` first to see the apps, their profiles and tools, then each ' +
  "app's `overview`. Read before writing: writes change what the apps show. Tools take an optional `profile` " +
  '(a person at home); without it they use the profile this connection was approved for.';

type Id = string | number | null;
interface Rpc {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: Record<string, unknown>;
}

const reply = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** One JSON-RPC message: its response, or null for a notification (no id). */
export async function handleRpc(msg: unknown, backend: McpBackend): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, -32600, 'invalid request');
  const { id, method, params } = msg as Rpc;
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') return isRequest ? fail(id, -32600, 'invalid request') : null;
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled, ...
  try {
    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        return reply(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: await backend.listTools() });
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : '';
        const args = params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
        if (!name) return fail(id, -32602, 'tools/call needs a name');
        try {
          const out = await backend.callTool(name, args);
          const text = JSON.stringify(out ?? null, null, 1);
          return reply(id, {
            content: [{ type: 'text', text }],
            // Objects also as structured content, for clients that read it.
            ...(out && typeof out === 'object' && !Array.isArray(out) ? { structuredContent: out } : {})
          });
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: errorText(e) }], isError: true });
        }
      }
      case 'resources/list':
        return reply(id, { resources: [] });
      case 'prompts/list':
        return reply(id, { prompts: [] });
      default:
        return fail(id, -32601, `no method ${method}`);
    }
  } catch (e) {
    return fail(id, -32603, errorText(e));
  }
}

/**
 * A POST body: one message or a batch. status 202 with no body when it held only notifications or
 * responses (Streamable HTTP), else 200 with the answer(s).
 */
export async function handleBody(body: unknown, backend: McpBackend): Promise<{ status: number; json?: unknown }> {
  if (Array.isArray(body)) {
    if (!body.length) return { status: 400, json: fail(null, -32600, 'empty batch') };
    const out = (await Promise.all(body.map((m) => handleRpc(m, backend)))).filter((r) => r !== null);
    return out.length ? { status: 200, json: out } : { status: 202 };
  }
  if (body === undefined) return { status: 400, json: fail(null, -32700, 'parse error') };
  const out = await handleRpc(body, backend);
  return out ? { status: 200, json: out } : { status: 202 };
}

function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'body' in e) {
    // SvelteKit's error(404, 'message')
    const b = (e as { body?: { message?: string } }).body;
    if (b?.message) return b.message;
  }
  return e instanceof Error ? e.message : String(e);
}
