import { describe, expect, it } from 'vitest';
import { formatDelta, formatKpi, normalizeTile, safeHref } from './tiles';

describe('normalizeTile', () => {
  it('turns junk into an empty state', () => {
    expect(normalizeTile(null)).toEqual({ empty: { message: 'Nothing to show yet' } });
    expect(normalizeTile({ kpis: 'x', series: 3 })).toEqual({ empty: { message: 'Nothing to show yet' } });
  });
  it('keeps at most two kpis and drops bad ones', () => {
    const t = normalizeTile({ kpis: [{ label: 'A', value: 1 }, { value: 2 }, { label: 'B', value: NaN }, { label: 'C', value: 3 }] });
    expect(t.kpis).toEqual([{ label: 'A', value: 1 }, { label: 'B', value: null }]);
  });
  it('clamps series, list and strings', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ label: `d${i}`, value: i }));
    const t = normalizeTile({
      series: { kind: 'bars', points, hue: 'red' },
      list: Array.from({ length: 9 }, (_, i) => ({ label: 'x'.repeat(100) + i, meta: '09:00' }))
    });
    expect(t.series?.points).toHaveLength(90);
    expect(t.series?.points[0].label).toBe('d110');
    expect(t.series?.hue).toBe('red');
    expect(t.list).toHaveLength(5);
    expect(t.list![0].label.length).toBe(60);
  });
  it('ignores unknown hues and series without any value', () => {
    expect(normalizeTile({ series: { kind: 'line', points: [{ label: 'a', value: 1 }], hue: 'url(x)' } }).series?.hue).toBeUndefined();
    expect(normalizeTile({ series: { kind: 'line', points: [{ label: 'a', value: null }] } }).series).toBeUndefined();
  });
  it('accepts only shell paths as links', () => {
    expect(normalizeTile({ empty: { message: 'm', action: { label: 'Go', href: 'javascript:alert(1)' } } }).empty).toEqual({ message: 'm' });
    expect(normalizeTile({ kpis: [{ label: 'a', value: 1 }], href: '//evil.example' }).href).toBeUndefined();
    expect(safeHref('/health?metric=hrv')).toBe('/health?metric=hrv');
    expect(safeHref('/\\evil')).toBeUndefined();
    expect(safeHref('https://x.y/')).toBeUndefined();
  });
  it('strips control characters from text', () => {
    expect(normalizeTile({ empty: { message: 'a\u0000b\nc' } }).empty?.message).toBe('a b c');
  });
});

describe('formatting', () => {
  it('prints numbers, durations and dashes', () => {
    expect(formatKpi({ value: null })).toBe('–');
    expect(formatKpi({ value: 12345 })).toBe('12 345');
    expect(formatKpi({ value: 7.25 })).toBe('7.3');
    expect(formatKpi({ value: 27120, format: 'duration' })).toBe('7h 32m');
  });
  it('gives deltas an arrow, a sign and a tone', () => {
    expect(formatDelta({ label: 'x', value: 50, delta: -3, better: 'down' })).toEqual({ text: '−3', tone: 'good', arrow: '↓' });
    expect(formatDelta({ label: 'x', value: 50, delta: 2.5, better: 'down' })).toEqual({ text: '+2.5', tone: 'bad', arrow: '↑' });
    expect(formatDelta({ label: 'x', value: 50, delta: 4 })).toEqual({ text: '+4', tone: 'flat', arrow: '↑' });
    expect(formatDelta({ label: 'x', value: 50, delta: 0.01, digits: 0 })).toEqual({ text: '±0', tone: 'flat', arrow: '→' });
    expect(formatDelta({ label: 'x', value: 1, delta: 600, format: 'duration', better: 'up' })?.text).toBe('+10 min');
    expect(formatDelta({ label: 'x', value: 1 })).toBeNull();
  });
});
