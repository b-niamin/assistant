import { expect, it } from 'vitest';
import { createLimiter } from './rate-limit';

it('blocks after the limit and frees the key after the window', () => {
  let t = 0;
  const l = createLimiter(2, 1000, () => t);
  expect(l.attempt('ip')).toBe(true);
  expect(l.attempt('ip')).toBe(true);
  expect(l.attempt('ip')).toBe(false);
  t = 1000;
  expect(l.attempt('ip')).toBe(true);
});
