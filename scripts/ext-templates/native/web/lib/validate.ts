/** Pure helpers: unit-tested without a database. */
export function cleanTitle(raw: unknown): string | null {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return t.length >= 1 && t.length <= 200 ? t : null;
}
