/**
 * The extensions the shell serves, as they are right now: the ones compiled in (generated from
 * extensions/installed.json) with the switches from System settings (core.extension_settings) applied.
 * Read through a small in-process cache; every settings write calls invalidate().
 */
import { db } from '#lib/server/db.ts';
import { EXTENSIONS } from './generated/registry';
import type { ExtensionInfo } from './types';

export { EXTENSIONS };

export interface ExtensionSetting {
  extension_id: string;
  enabled: boolean;
  profiles: string[] | null;
}

/** Pure merge, unit-tested: installed.json order, switches from System settings applied. */
export function mergeExtensions(compiled: ExtensionInfo[], settings: ExtensionSetting[]): ExtensionInfo[] {
  const byId = new Map(settings.map((s) => [s.extension_id, s]));
  return compiled.map((e) => {
    const s = byId.get(e.id);
    return s ? { ...e, enabled: s.enabled, profiles: s.profiles ?? null } : e;
  });
}

let cache: Promise<ExtensionInfo[]> | null = null;

export function invalidate(): void {
  cache = null;
}

/** Every extension, including switched-off ones (System settings lists them). */
export function allExtensions(): Promise<ExtensionInfo[]> {
  if (!cache) {
    cache = db()<ExtensionSetting[]>`SELECT extension_id, enabled, profiles FROM core.extension_settings`
      .then((settings) => mergeExtensions(EXTENSIONS, settings))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export const visibleTo = (ext: ExtensionInfo, profileId: string): boolean =>
  ext.enabled && (ext.profiles === null || ext.profiles.includes(profileId));

/** Extensions the profile can open, in nav order. */
export async function extensionsFor(profileId: string): Promise<ExtensionInfo[]> {
  return (await allExtensions()).filter((e) => visibleTo(e, profileId));
}

export async function extensionById(id: string): Promise<ExtensionInfo | undefined> {
  return (await allExtensions()).find((e) => e.id === id);
}

/** The extension that owns a URL path (/health/x), if any. */
export async function extensionForPath(pathname: string): Promise<ExtensionInfo | undefined> {
  const first = pathname.split('/')[1] ?? '';
  return (await allExtensions()).find((e) => e.id === first);
}

/** On/off and who sees it, from the extension's settings panel. */
export async function saveExtensionSwitches(id: string, enabled: boolean, profiles: string[] | null): Promise<void> {
  await db()`INSERT INTO core.extension_settings (extension_id, enabled, profiles)
             VALUES (${id}, ${enabled}, ${profiles})
             ON CONFLICT (extension_id) DO UPDATE SET enabled = EXCLUDED.enabled, profiles = EXCLUDED.profiles, updated_at = now()`;
  invalidate();
}
