import { describe, expect, it } from 'vitest';
import { visibleFor, type Caller } from './backend.server';
import type { ExtensionTools } from '#lib/extensions/tools.server.ts';

const tool = (name: string, readOnly: boolean) => ({ name, title: name, description: '', input: { type: 'object' as const, properties: {} }, readOnly, destructive: !readOnly });
const ext = (id: string, tools: ReturnType<typeof tool>[]): ExtensionTools => ({ id, name: id, description: '', kind: 'native', scope: 'profile', languages: ['en'], tools });
const exts = [
  ext('health', [tool('describe', true), tool('query', true), tool('overview', true), tool('add_journal_entry', false)]),
  ext('gym', [tool('read_data', true), tool('write_data', false), tool('overview', true), tool('log_workout', false)]),
  ext('home', [tool('overview', true)])
];
const connector = (scope: string, extensions: string[] | null): Caller => ({ kind: 'connector', grantId: 'g', client: 'Claude', profileId: 'p', endpointId: 'e', endpoint: 'All apps', scope, extensions });
const names = (c: Caller) => visibleFor(c, exts).flatMap((e) => e.tools.map((t) => `${e.id}__${t.name}`));

describe('what a caller sees', () => {
  it('gives the terminal everything', () => {
    expect(names({ kind: 'terminal', profileId: 'p' })).toHaveLength(9);
  });
  it('gives a read-only connection the overviews, no raw SQL or saved data', () => {
    expect(names(connector('mcp:read', null))).toEqual(['health__overview', 'gym__overview', 'home__overview']);
  });
  it('adds the apps own writes with mcp:write, still no raw writes', () => {
    expect(names(connector('mcp:read mcp:write', null))).toEqual(['health__overview', 'health__add_journal_entry', 'gym__overview', 'gym__log_workout', 'home__overview']);
  });
  it('shows only the apps the connection was approved for', () => {
    expect(names(connector('mcp:read', ['gym']))).toEqual(['gym__overview']);
  });
});
