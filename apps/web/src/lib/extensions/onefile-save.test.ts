import { describe, expect, it } from 'vitest';
import { batchBody, freshBatch, isEmpty, mergeBatch } from './onefile-save';

describe('onefile save batches', () => {
  it('puts a failed batch back under the newer writes', () => {
    const failed = { set: { a: '1', b: '1' }, remove: new Set(['c']), clear: false };
    const since = { set: { b: '2', c: '2' }, remove: new Set(['a']), clear: false };
    const m = mergeBatch(failed, since);
    expect(m.set).toEqual({ b: '2', c: '2' });
    expect([...m.remove]).toEqual(['a']);
  });
  it('lets a newer clear win', () => {
    const m = mergeBatch({ set: { a: '1' }, remove: new Set(), clear: false }, { set: { z: '1' }, remove: new Set(), clear: true });
    expect(m).toMatchObject({ set: { z: '1' }, clear: true });
  });
  it('sends the version the app saw of each key, 0 for new ones', () => {
    const body = batchBody({ set: { 'gym-notebook.v1': '{}', fresh: 'x' }, remove: new Set(['old']), clear: false }, { 'gym-notebook.v1': 7, old: 2 });
    expect(body.base).toEqual({ 'gym-notebook.v1': 7, fresh: 0, old: 2 });
  });
  it('knows an empty batch', () => {
    expect(isEmpty(freshBatch())).toBe(true);
    expect(isEmpty({ ...freshBatch(), clear: true })).toBe(false);
  });
});
