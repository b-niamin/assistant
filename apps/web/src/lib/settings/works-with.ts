/**
 * "Works better with" at the bottom of an extension's settings panel (manifest "worksWith", spec 002): the
 * extensions it names that are not installed (offered from the catalog) or switched off. Pure.
 */
import type { ExtensionInfo, WorksWith } from '#lib/extensions/types.ts';

export interface Suggestion {
  id: string;
  name: string;
  /** What it adds to this extension, in the page's language. */
  why: string;
  /** missing: offered by the extensions repo, install it. off: installed but switched off. */
  state: 'missing' | 'off';
  accessory?: string;
}

export function suggestionsFor(
  worksWith: WorksWith[] | undefined,
  installed: Pick<ExtensionInfo, 'id' | 'name' | 'enabled' | 'accessory'>[],
  catalog: { id: string; name: string; accessory?: string }[]
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const w of worksWith ?? []) {
    const have = installed.find((e) => e.id === w.id);
    if (have) {
      if (!have.enabled) out.push({ id: w.id, name: have.name, why: w.why, state: 'off', ...(have.accessory ? { accessory: have.accessory } : {}) });
      continue;
    }
    // Only what the extensions repo offers can be installed with one click; anything else is left out.
    const c = catalog.find((e) => e.id === w.id);
    if (c) out.push({ id: w.id, name: c.name, why: w.why, state: 'missing', ...(c.accessory ? { accessory: c.accessory } : {}) });
  }
  return out;
}
