import { describe, expect, it } from 'vitest';
import { busy, normalizeSources } from './sources';

describe('normalizeSources', () => {
  it('keeps a well-formed source and clamps the progress', () => {
    const [s] = normalizeSources([
      {
        id: 'garmin',
        name: 'Garmin Connect',
        state: 'connected',
        sync: { state: 'running', progress: 1.7, label: 'Fetching history', lastAt: '2026-11-09T10:00:00Z' },
        facts: [{ label: 'Activities', value: '412' }, { label: 'bad' }],
        actions: [{ id: 'sync-now', label: 'Sync now' }, { id: 'sync-now', label: 'Twice' }, { id: 'Bad Id', label: 'x' }]
      }
    ]);
    expect(s.sync).toMatchObject({ state: 'running', progress: 1, lastAt: '2026-11-09T10:00:00.000Z' });
    expect(s.facts).toEqual([{ label: 'Activities', value: '412' }]);
    expect(s.actions).toEqual([{ id: 'sync-now', label: 'Sync now' }]);
  });

  it('drops unknown states, duplicate ids and junk', () => {
    const out = normalizeSources([
      { id: 'a', name: 'A', state: 'connected' },
      { id: 'a', name: 'Again', state: 'connected' },
      { id: 'b', name: 'B', state: 'weird' },
      'nope',
      { id: 'c', name: 'C', state: 'planned', sync: { state: 'nonsense' } }
    ]);
    expect(out.map((s) => s.id)).toEqual(['a', 'c']);
    expect(out[1].sync).toBeUndefined();
    expect(normalizeSources(null)).toEqual([]);
  });

  it('keeps only valid dates on a dated action', () => {
    const [s] = normalizeSources([
      { id: 'g', name: 'G', state: 'connected', actions: [{ id: 'older', label: 'Older', date: { label: 'Back to', default: 'soon', max: '2026-11-09' } }] }
    ]);
    expect(s.actions?.[0].date).toEqual({ label: 'Back to', default: undefined, min: undefined, max: '2026-11-09' });
  });

  it('is busy while a sync runs or waits', () => {
    expect(busy(normalizeSources([{ id: 'a', name: 'A', state: 'connected', sync: { state: 'queued' } }]))).toBe(true);
    expect(busy(normalizeSources([{ id: 'a', name: 'A', state: 'connected', sync: { state: 'idle' } }]))).toBe(false);
  });
});
