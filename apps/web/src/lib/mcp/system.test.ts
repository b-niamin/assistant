import { describe, expect, it } from 'vitest';
import { extensionUpdates } from '#lib/settings/ext-updates.ts';
import { coreVersion, extensionVersions, mcpUpdatePrompt, pickUpdates } from './system';

const installed = [
  { id: 'health', name: 'Health', version: '1.2.0' },
  { id: 'training', name: 'Training', version: '1.5.1' },
  { id: 'home', name: 'Home', version: '1.0.0' },
  { id: 'mine', name: 'Mine', version: '0.1.0' }
];
const cat = [
  { id: 'health', version: '1.3.0', shell: 9 },
  { id: 'training', version: '1.5.1', shell: 9 },
  { id: 'home', version: '2.0.0', shell: 12 }
];
const updates = extensionUpdates(installed, cat, 9);

describe('versions', () => {
  it('tells each installed extension where it stands', () => {
    expect(extensionVersions(installed, cat, updates).map((e) => [e.id, e.state, e.available])).toEqual([
      ['health', 'update', '1.3.0'],
      ['training', 'current', '1.5.1'],
      ['home', 'needs_core', '2.0.0'],
      ['mine', 'not_in_catalog', null]
    ]);
  });
  it('says unknown when the catalog could not be read', () => {
    expect(extensionVersions(installed, null, { ready: [], waiting: [] }).every((e) => e.state === 'unknown')).toBe(true);
  });
  it('compares the running core with GitHub', () => {
    const s = { sha: 'abc', deployedSha: 'abcdef1234567890', branch: 'main', status: 'ok' };
    expect(coreVersion(s, 'abcdef1234567890ff', 9)).toMatchObject({ running: 'abcdef123456', update_available: false, shell_api: 9 });
    expect(coreVersion(s, '0123456789', 9).update_available).toBe(true);
    expect(coreVersion(null, null, 9)).toMatchObject({ running: '', latest: null, update_available: null, updater: 'none' });
  });
});

describe('what update_extensions updates', () => {
  it('takes every update this core can take by default', () => {
    expect(pickUpdates(updates, undefined).map((u) => u.id)).toEqual(['health']);
  });
  it('takes the named ones', () => {
    expect(pickUpdates(updates, ['health', 'health']).map((u) => `${u.from}->${u.to}`)).toEqual(['1.2.0->1.3.0']);
  });
  it('refuses one that needs a newer core, or has no update', () => {
    expect(() => pickUpdates(updates, ['home'])).toThrow(/shell API 12/);
    expect(() => pickUpdates(updates, ['training'])).toThrow(/no update/);
    expect(() => pickUpdates({ ready: [], waiting: [] }, undefined)).toThrow(/already/);
  });
  it('tells the chat where the request came from', () => {
    expect(mcpUpdatePrompt('Update health.', 'Claude')).toBe('Update health. (Asked through the MCP connector by Claude; the owner confirmed it there.)');
  });
});
