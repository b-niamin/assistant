import { describe, expect, it } from 'vitest';
import { arrowSeq, BAR_KEYS, ctrlOf } from './keys';
import { FONT_SIZES, stepFontSize } from './theme';

describe('ctrlOf', () => {
  it('maps letters to control codes, either case', () => {
    expect(ctrlOf('c')).toBe('\x03');
    expect(ctrlOf('C')).toBe('\x03');
    expect(ctrlOf('a')).toBe('\x01');
    expect(ctrlOf('z')).toBe('\x1a');
  });
  it('maps the usual punctuation', () => {
    expect(ctrlOf('[')).toBe('\x1b');
    expect(ctrlOf(' ')).toBe('\x00');
  });
  it('leaves other input alone', () => {
    expect(ctrlOf('1')).toBeNull();
    expect(ctrlOf('ab')).toBeNull();
    expect(ctrlOf('')).toBeNull();
  });
});

describe('arrowSeq', () => {
  it('uses CSI normally and SS3 in application cursor mode', () => {
    expect(arrowSeq('up', false)).toBe('\x1b[A');
    expect(arrowSeq('left', true)).toBe('\x1bOD');
  });
});

describe('key bar', () => {
  it('has unique labels and exactly one Ctrl key', () => {
    const labels = BAR_KEYS.map((k) => k.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(BAR_KEYS.filter((k) => k.kind === 'ctrl')).toHaveLength(1);
  });
});

describe('stepFontSize', () => {
  it('moves one step and stops at the ends', () => {
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(FONT_SIZES[0], -1)).toBe(FONT_SIZES[0]);
    expect(stepFontSize(99, 1)).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
  });
  it('snaps an off-scale size onto the scale', () => {
    expect(stepFontSize(13.5, -1)).toBe(13);
  });
});
