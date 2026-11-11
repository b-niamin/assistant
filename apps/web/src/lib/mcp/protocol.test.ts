import { describe, expect, it } from 'vitest';
import { handleBody, handleRpc, PROTOCOL_VERSIONS, type McpBackend } from './protocol';

const backend: McpBackend = {
  listTools: async () => [{ name: 'gym__overview', description: 'x', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
  callTool: async (name, args) => {
    if (name === 'bad') throw new Error('nope');
    return { name, args };
  }
};

describe('mcp protocol', () => {
  it('negotiates the version and says who it is', async () => {
    const r = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, backend)) as { result: { protocolVersion: string; capabilities: object } };
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    const old = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, backend)) as { result: { protocolVersion: string } };
    expect(old.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });
  it('answers notifications with 202 and nothing else', async () => {
    expect(await handleBody({ jsonrpc: '2.0', method: 'notifications/initialized' }, backend)).toEqual({ status: 202 });
    expect((await handleBody(undefined, backend)).status).toBe(400);
  });
  it('lists and calls tools; a failing tool is a tool error, not a protocol error', async () => {
    const list = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, backend)) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['gym__overview']);
    const out = await handleBody(
      [
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bad' } },
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'gym__overview', arguments: { days: 7 } } }
      ],
      backend
    );
    expect(out.json).toEqual([
      { jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'nope' }], isError: true } },
      {
        jsonrpc: '2.0',
        id: 5,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ name: 'gym__overview', args: { days: 7 } }, null, 1) }],
          structuredContent: { name: 'gym__overview', args: { days: 7 } }
        }
      }
    ]);
  });
  it('refuses unknown methods and malformed messages', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', id: 6, method: 'sampling/createMessage' }, backend)).toMatchObject({ error: { code: -32601 } });
    expect(await handleRpc('x', backend)).toMatchObject({ error: { code: -32600 } });
  });
});
