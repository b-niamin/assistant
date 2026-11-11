/** Where to go after logging in: a path on this site only, never another origin (`//x`, `/\\x`, `https:`). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.includes('\\')) return '/';
  try {
    const u = new URL(next, 'http://same.invalid');
    return u.origin === 'http://same.invalid' ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}
