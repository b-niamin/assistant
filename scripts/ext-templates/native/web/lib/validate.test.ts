import { expect, it } from 'vitest';
import { cleanTitle } from './validate';

it('trims and limits titles', () => {
  expect(cleanTitle('  a   b ')).toBe('a b');
  expect(cleanTitle('')).toBeNull();
  expect(cleanTitle('x'.repeat(201))).toBeNull();
});
