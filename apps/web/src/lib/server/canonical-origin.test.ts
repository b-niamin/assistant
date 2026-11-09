import { describe, expect, it } from 'vitest';
import { canonicalRedirect } from './canonical-origin.ts';

const ORIGIN = 'https://nas.tail1234.ts.net:8446';

describe('canonicalRedirect', () => {
  it('sends the public name on another port to the public origin', () => {
    expect(canonicalRedirect('GET', 'nas.tail1234.ts.net', '/login?next=%2F', ORIGIN)).toBe(`${ORIGIN}/login?next=%2F`);
    expect(canonicalRedirect('HEAD', 'NAS.tail1234.ts.net:8443', '/', ORIGIN)).toBe(`${ORIGIN}/`);
  });

  it('works the other way round, for an origin on the default port', () => {
    expect(canonicalRedirect('GET', 'nas.tail1234.ts.net:8446', '/x', 'https://nas.tail1234.ts.net')).toBe('https://nas.tail1234.ts.net/x');
  });

  it('leaves the public origin, other hosts and non-page methods alone', () => {
    expect(canonicalRedirect('GET', 'nas.tail1234.ts.net:8446', '/', ORIGIN)).toBeNull();
    expect(canonicalRedirect('GET', 'localhost:3000', '/healthz', ORIGIN)).toBeNull();
    expect(canonicalRedirect('GET', 'web:3000', '/', ORIGIN)).toBeNull();
    expect(canonicalRedirect('POST', 'nas.tail1234.ts.net', '/login', ORIGIN)).toBeNull();
    expect(canonicalRedirect('GET', null, '/', ORIGIN)).toBeNull();
    expect(canonicalRedirect('GET', 'nas.tail1234.ts.net', '/', '')).toBeNull();
  });
});
