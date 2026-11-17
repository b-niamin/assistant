import type { ExtensionInfo, ExtPage } from '#lib/extensions/types.ts';

/** The extension a path belongs to: /<id> or /<id>/... */
export function extensionAt(extensions: ExtensionInfo[], pathname: string): ExtensionInfo | null {
  return extensions.find((e) => pathname === e.href || pathname.startsWith(`${e.href}/`)) ?? null;
}

/**
 * The page navigation for a path (PageHead): the extension's pages when the path is one of them, with
 * the current one. A page further in (/training/session/1) gets none: it has a back button instead.
 */
export function pagesOf(extensions: ExtensionInfo[], pathname: string): { ext: ExtensionInfo; pages: ExtPage[]; current: string } | null {
  const ext = extensionAt(extensions, pathname);
  if (!ext || ext.pages.length < 2) return null;
  const path = pathname.replace(/\/$/, '') || '/';
  const hit = ext.pages.find((p) => p.href === path);
  return hit ? { ext, pages: ext.pages, current: hit.href } : null;
}

/** The tab bar on a phone: the dashboard, the first apps in nav order, and More when they do not fit. */
export function tabsOf<T extends { href: string }>(extensions: T[], max = 5): { shown: T[]; more: boolean } {
  // Home takes one slot; when everything else fits there is no More.
  if (extensions.length <= max - 1) return { shown: extensions, more: false };
  return { shown: extensions.slice(0, max - 2), more: true };
}
