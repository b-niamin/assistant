import { describe, expect, it, vi } from 'vitest';

vi.mock('./kv.server', () => ({ kvAll: async () => ({}) }));
vi.mock('./runtime.server', () => ({ contextFor: () => ({}) }));
vi.mock('./registry', () => ({ extensionsFor: () => [] }));
vi.mock('./generated/tiles.server', () => ({ TILE_MODULES: {} }));

const { settle } = await import('./dashboard.server');

describe('settle', () => {
  it('normalizes a good tile', async () =>
    expect(await settle('x', async () => ({ kpis: [{ label: 'A', value: 1 }] }))).toEqual({
      ok: true,
      data: { kpis: [{ label: 'A', value: 1 }] }
    }));
  it('turns a throw into an error result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await settle('x', () => Promise.reject(new Error('boom')))).toEqual({ ok: false, reason: 'error' });
  });
  it('times out a slow tile', async () =>
    expect(await settle('x', () => new Promise(() => {}), 20)).toEqual({ ok: false, reason: 'timeout' }));
});
