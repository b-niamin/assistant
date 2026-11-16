import { describe, expect, it } from 'vitest';
import { suggestionsFor } from './works-with';

const ww = [
  { id: 'calendar', why: 'Today on the board.' },
  { id: 'weather', why: 'Forecast.' },
  { id: 'notes', why: 'Notes.' }
];

describe('suggestionsFor', () => {
  it('offers what is missing from the catalog, what is switched off, and nothing that is on', () => {
    const installed = [
      { id: 'notes', name: 'Notes', enabled: false, accessory: null },
      { id: 'weather', name: 'Weather', enabled: true, accessory: null }
    ];
    const catalog = [{ id: 'calendar', name: 'Kalendarz', accessory: 'pencil' }];
    expect(suggestionsFor(ww, installed, catalog)).toEqual([
      { id: 'calendar', name: 'Kalendarz', why: 'Today on the board.', state: 'missing', accessory: 'pencil' },
      { id: 'notes', name: 'Notes', why: 'Notes.', state: 'off' }
    ]);
  });
  it('leaves out what the catalog does not offer', () => {
    expect(suggestionsFor(ww, [], [])).toEqual([]);
    expect(suggestionsFor(undefined, [], [])).toEqual([]);
  });
});
