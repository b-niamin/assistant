import { describe, expect, it } from 'vitest';
import { lineFor, moodFor, moodForHour } from './mascot';

describe('mascot', () => {
  it('maps readiness bands to moods', () => {
    expect(moodFor(90)).toBe('charged');
    expect(moodFor(60)).toBe('steady');
    expect(moodFor(30)).toBe('tired');
    expect(moodFor(5)).toBe('asleep');
    expect(moodFor(null)).toBe('idle');
  });
  it('follows the time of day', () => {
    expect(moodForHour(3)).toBe('asleep');
    expect(moodForHour(8)).toBe('charged');
    expect(moodForHour(15)).toBe('steady');
    expect(moodForHour(23)).toBe('tired');
  });
  it('keeps the same line for a day', () => {
    expect(lineFor('steady', '2026-11-03')).toBe(lineFor('steady', '2026-11-03'));
    expect(typeof lineFor('idle', '2026-11-04')).toBe('string');
  });
});
