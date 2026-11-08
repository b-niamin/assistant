import { describe, expect, it, vi } from 'vitest';
import { infoOf, jsonSafe, validTools } from './tools';

vi.mock('$app/env/private', () => ({ CLAUDE_TOOLS_TOKEN: undefined }));
const { claudeTokenMatches } = await import('#lib/server/claude-token.ts');

describe('extension tools', () => {
  const run = () => 1;
  it('keeps well-formed, unique tools and skips reserved names', () => {
    const tools = validTools(
      [{ name: 'ok', description: '', run }, { name: 'Bad-Name', description: '', run }, { name: 'ok', description: 'dup', run }, { name: 'query', description: '', run }, { name: 'noop' }],
      new Set(['query'])
    );
    expect(tools.map((t) => t.name)).toEqual(['ok']);
    expect(validTools('nope')).toEqual([]);
  });
  it('gives every tool an object schema', () => {
    expect(infoOf({ name: 'a', description: 'x' }).input).toEqual({ type: 'object', properties: {} });
  });
  it('makes rows JSON-safe', () => {
    expect(jsonSafe({ n: 10n, d: new Date('2026-01-02T00:00:00Z') })).toEqual({ n: '10', d: '2026-01-02T00:00:00.000Z' });
  });
});

describe('claude tools token', () => {
  const token = 'x'.repeat(40);
  it('needs a long token and an exact bearer match', () => {
    expect(claudeTokenMatches(`Bearer ${token}`, token)).toBe(true);
    expect(claudeTokenMatches(`Bearer ${token}y`, token)).toBe(false);
    expect(claudeTokenMatches(token, token)).toBe(false);
    expect(claudeTokenMatches(null, token)).toBe(false);
    expect(claudeTokenMatches('Bearer short', 'short')).toBe(false);
  });
});
