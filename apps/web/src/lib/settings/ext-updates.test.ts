import { describe, expect, it } from 'vitest';
import { compareVersions, extensionUpdates } from './ext-updates';

describe('extension updates', () => {
  it('compares versions number by number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersions('junk', '0.0.1')).toBe(-1);
  });

  it('offers newer versions, holds back the ones that need a newer core', () => {
    const installed = [
      { id: 'health', name: 'Health', version: '1.2.0' },
      { id: 'training', name: 'Training', version: '1.5.0' },
      { id: 'home', name: 'Home', version: '2.3.0' },
      { id: 'mine', name: 'Mine', version: '0.1.0' }
    ];
    const catalog = [
      { id: 'health', version: '1.3.0', shell: 8 },
      { id: 'training', version: '1.6.0', shell: 9 },
      { id: 'home', version: '2.3.0', shell: 7 },
      { id: 'calendar', version: '1.3.0' }
    ];
    expect(extensionUpdates(installed, catalog, 8)).toEqual({
      ready: [{ id: 'health', name: 'Health', from: '1.2.0', to: '1.3.0', shell: 8 }],
      waiting: [{ id: 'training', name: 'Training', from: '1.5.0', to: '1.6.0', shell: 9 }]
    });
  });

  it('offers nothing when the catalog has no versions (an older extensions repo)', () => {
    expect(extensionUpdates([{ id: 'health', name: 'H', version: '1.0.0' }], [{ id: 'health' }], 8)).toEqual({ ready: [], waiting: [] });
  });
});
