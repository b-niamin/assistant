import { describe, expect, it } from 'vitest';
import { addItems, itemHint, removeItem, splitItems } from './secret-items';

describe('secret items', () => {
  it('reads old space-separated values and stores one item per line', () => {
    expect(splitItems('a b,c\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(addItems('a b', 'c a')).toBe('a\nb\nc');
    expect(addItems(null, ' x ')).toBe('x');
  });
  it('removes by position', () => {
    expect(removeItem('a\nb\nc', 1)).toBe('a\nc');
    expect(removeItem('a', 0)).toBe('');
    expect(() => removeItem('a', 3)).toThrow('already gone');
  });
  it('names a link without showing it', () => {
    expect(itemHint('webcal://p01-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Ng')).toBe('p01-caldav.icloud.com …Q1Ng');
    expect(itemHint('https://calendar.google.com/calendar/ical/abc%40group/private-0123456789abcdef/basic.ics')).toBe('calendar.google.com …cdef');
    expect(itemHint('short')).toBe('•••');
  });
});
