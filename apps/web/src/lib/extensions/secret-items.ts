/**
 * A secret that holds a list (manifest "multiple": true, e.g. calendar subscription links): items without
 * spaces, stored as one secret, one item per line, so ctx.secrets.get still returns a plain string. The
 * settings card shows each item by a hint only (the host and a few characters), never the whole value.
 */
export const MAX_ITEMS = 20;

/** The items of a stored value, or of what was typed (separated by spaces or new lines). */
export const splitItems = (v: string | null | undefined): string[] => (v ?? '').split(/\s+/).filter(Boolean);

/** The stored value after adding what was typed (one item or several, separated by spaces). */
export function addItems(stored: string | null, typed: string): string {
  const items = splitItems(stored);
  for (const it of splitItems(typed)) if (!items.includes(it)) items.push(it);
  if (items.length > MAX_ITEMS) throw new Error('Too many items (at most 20).');
  return items.join('\n');
}

/** The stored value without item `index` ('' when nothing is left). */
export function removeItem(stored: string | null, index: number): string {
  const items = splitItems(stored);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('That item is already gone.');
  items.splice(index, 1);
  return items.join('\n');
}

/** How a row names an item: a link by its host and the last characters of its longest path part. */
export function itemHint(item: string): string {
  const tail = (s: string) => (s.length > 8 ? ` …${s.slice(-4)}` : '');
  try {
    const u = new URL(item.replace(/^webcal:/i, 'https:'));
    const longest = u.pathname.split('/').reduce((a, b) => (b.length > a.length ? b : a), '');
    return `${u.host}${tail(longest)}`;
  } catch {
    return tail(item).trim() || '•••';
  }
}
