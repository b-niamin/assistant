/**
 * The settings sidebar (routes/settings/+layout.svelte): one shell for the profile's own settings and the
 * system's. Each entry is a page under /settings; `match` also lights it on pages below it (an app's panel
 * lights Apps). Labels are English and go through t() where they are shown.
 */
export type NavId =
  | 'overview'
  | 'profile'
  | 'apps'
  | 'profiles'
  | 'language'
  | 'connector'
  | 'ai'
  | 'updates'
  | 'backups'
  | 'worker'
  | 'logs'
  | 'browser'
  | 'security';

export interface NavItem {
  id: NavId;
  href: string;
  label: string;
  /** One or more SVG path `d`s on a 20x20 grid, drawn as 1.7px strokes. */
  icon: string[];
  match?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const SETTINGS_NAV: NavGroup[] = [
  {
    label: '',
    items: [{ id: 'overview', href: '/settings', label: 'Overview', icon: ['M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z'] }]
  },
  {
    label: 'You',
    items: [
      {
        id: 'profile',
        href: '/settings/profile',
        label: 'My profile',
        icon: ['M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M3.5 17c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5']
      }
    ]
  },
  {
    label: 'Apps and people',
    items: [
      {
        id: 'apps',
        href: '/settings/apps',
        label: 'Apps',
        icon: ['M4 4h4.5v4.5H4zM11.5 4H16v4.5h-4.5zM4 11.5h4.5V16H4z', 'M13.75 11.5v4.5M11.5 13.75H16'],
        match: ['/settings/extensions']
      },
      {
        id: 'profiles',
        href: '/settings/profiles',
        label: 'Profiles',
        icon: ['M7.5 9a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z', 'M2.5 16c.7-2.6 2.6-4 5-4s4.3 1.4 5 4', 'M13 4a2.6 2.6 0 0 1 0 5M14.5 12.2c1.4.5 2.4 1.8 3 3.8']
      },
      {
        id: 'language',
        href: '/settings/language',
        label: 'Language',
        icon: ['M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M3 10h14M10 3c-2 2-2.8 4.4-2.8 7s.8 5 2.8 7c2-2 2.8-4.4 2.8-7S12 5 10 3z']
      }
    ]
  },
  {
    label: 'AI',
    items: [
      {
        id: 'connector',
        href: '/settings/connector',
        label: 'Claude connector',
        icon: ['M10 3v14M3.9 6.5l12.2 7M3.9 13.5l12.2-7']
      },
      { id: 'ai', href: '/settings/ai', label: 'Terminal and AI', icon: ['M3.5 4.5h13v11h-13z', 'M6.5 8l2.5 2-2.5 2M10.5 12.5h3'] }
    ]
  },
  {
    label: 'This server',
    items: [
      { id: 'updates', href: '/settings/updates', label: 'Updates', icon: ['M16 10a6 6 0 1 1-1.8-4.3', 'M16 3.5v3.5h-3.5'] },
      {
        id: 'backups',
        href: '/settings/backups',
        label: 'Backups',
        icon: ['M4 5.5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2z', 'M4 5.5v9c0 1.1 2.7 2 6 2s6-.9 6-2v-9M4 10c0 1.1 2.7 2 6 2s6-.9 6-2']
      },
      {
        id: 'worker',
        href: '/settings/worker',
        label: 'Worker',
        icon: ['M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4']
      },
      { id: 'logs', href: '/settings/logs', label: 'Logs', icon: ['M4 5h12M4 8.5h12M4 12h8M4 15.5h10'] },
      {
        id: 'browser',
        href: '/settings/browser',
        label: 'Browser',
        icon: ['M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z', 'M3 8h14M5.5 6h.01M7.5 6h.01']
      },
      {
        id: 'security',
        href: '/settings/security',
        label: 'Security',
        icon: ['M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z', 'M7.5 10l1.8 1.8 3.2-3.3']
      }
    ]
  }
];

/** The entry a path belongs to: the longest href (or match) it starts with. */
export function activeNav(pathname: string): NavId | null {
  let best: { id: NavId; len: number } | null = null;
  for (const g of SETTINGS_NAV)
    for (const item of g.items)
      for (const prefix of [item.href, ...(item.match ?? [])]) {
        const hit = prefix === '/settings' ? pathname === '/settings' : pathname === prefix || pathname.startsWith(prefix + '/');
        if (hit && (!best || prefix.length > best.len)) best = { id: item.id, len: prefix.length };
      }
  return best?.id ?? null;
}
