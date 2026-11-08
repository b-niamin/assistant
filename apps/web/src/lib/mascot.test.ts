import { describe, expect, it } from 'vitest';
import { accessoryFor, accessoryOf, ACCESSORY_IDS, guessAccessory, lineFor, moodFor, moodForHour } from './mascot';
import { ACCESSORY_SVG } from './beni-accessories';

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

describe('accessories', () => {
  const exts = [
    { id: 'gym', name: 'Gym Tracker', accessory: 'headband' },
    { id: 'health', name: 'Training & Health', accessory: 'stethoscope' },
    { id: 'learning', name: 'Learning' },
    { id: 'odd', name: 'Something', accessory: 'cape' }
  ];
  it('dresses Beni for the page', () => {
    expect(accessoryFor('/', exts)).toBe('none');
    expect(accessoryFor('/gym', exts)).toBe('headband');
    expect(accessoryFor('/health/sleep', exts)).toBe('stethoscope');
    expect(accessoryFor('/learning', exts)).toBe('book');
    expect(accessoryFor('/settings', exts)).toBe('wrench');
    expect(accessoryFor('/settings/extensions/gym', exts)).toBe('wrench');
    expect(accessoryFor('/settings/terminal', exts)).toBe('glasses');
    expect(accessoryFor('/nowhere', exts)).toBe('none');
  });
  it('ignores unknown manifest values and guesses instead', () => {
    expect(accessoryOf(exts[3])).toBe('none');
    expect(guessAccessory('recipes', 'Family recipes')).toBe('chef-hat');
    expect(guessAccessory('budget')).toBe('coin');
    expect(guessAccessory('calendar', 'Family calendar')).toBe('pencil');
    expect(guessAccessory('home-assistant', 'Smart home')).toBe('bulb');
  });
  it('has a drawing for every accessory', () => {
    for (const a of ACCESSORY_IDS) expect(typeof ACCESSORY_SVG[a]).toBe('string');
  });
});
