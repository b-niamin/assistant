/**
 * The parts of this server and how they depend on each other, for System settings -> Infrastructure
 * (routes/settings/infrastructure). Static: what each part is, where its settings live, whether the app
 * may restart it, and where it sits on the diagram. Their live state comes from
 * lib/server/infrastructure.ts. Core only: no extension is named here (extensions run in `worker`).
 * Texts are English and go through t() where they are shown.
 */
export type PartId =
  | 'you'
  | 'claude'
  | 'github'
  | 'connector'
  | 'updater'
  | 'web'
  | 'db'
  | 'terminal'
  | 'browser'
  | 'worker'
  | 'backup'
  | 'ext-migrate';

/** Outside this machine, on the host itself, a container of the compose project, or an installed app (extension). */
export type PartKind = 'outside' | 'host' | 'container' | 'app';

export interface Part {
  /** A core part's id, or `app:<extension id>` for an installed app. */
  id: string;
  name: string;
  /** A shorter name for the diagram's box, when the name does not fit. */
  short?: string;
  /** What it is, one sentence. */
  what: string;
  kind: PartKind;
  /** SVG path `d`s on a 20x20 grid, drawn as strokes (like the settings sidebar's icons). */
  icon: string[];
  /** Its page in System settings, if it has one. */
  href?: string;
  /** Its log in System settings -> Logs. */
  log?: string;
  /** The compose service the app may ask the host's updater to restart (scripts/update.sh RESTARTABLE). */
  service?: string;
  /** What a restart ends, when it ends something (shown before the click). */
  restartNote?: string;
  /** Position on the diagram's grid, VIEW_W wide (top-left corner). */
  x: number;
  y: number;
}

export const NODE_W = 172;
export const NODE_H = 60;
export const VIEW_W = 900;
/** Where the row of installed apps starts, below the containers; each further row of APPS_PER_ROW is ROW_H lower. */
export const APPS_Y = 650;
export const APPS_PER_ROW = 4;
export const ROW_H = 92;

export const PARTS: Part[] = [
  { id: 'you', icon: ['M6 4h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M9 13.5h2'], name: 'You', what: 'Your browser or phone, on your tailnet.', kind: 'outside', x: 60, y: 40 },
  {
    id: 'claude',
    icon: ['M10 3v14M3.9 6.5l12.2 7M3.9 13.5l12.2-7'],
    name: 'claude.ai',
    what: 'Claude on the web and in its apps: reaches the apps\' tools through the connector.',
    kind: 'outside',
    href: '/settings/connector',
    x: 364,
    y: 40
  },
  {
    id: 'github',
    icon: ['M6 5.5a1.5 1.5 0 1 0 0-.01M6 7v6M6 16a1.5 1.5 0 1 0 0-.01M14 7.5a1.5 1.5 0 1 0 0-.01M14 9c0 3-8 2-8 4'],
    name: 'GitHub',
    what: 'Holds main: the version this server runs.',
    kind: 'outside',
    href: '/settings/updates',
    x: 668,
    y: 40
  },
  {
    id: 'connector',
    icon: ['M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M3 10h14M10 3c-2 2-2.8 4.4-2.8 7s.8 5 2.8 7c2-2 2.8-4.4 2.8-7S12 5 10 3z'],
    name: 'MCP on the internet',
    short: 'Internet MCP',
    what: 'Tailscale Funnel on the host: opens only /mcp of the app to the internet, with sign-in.',
    kind: 'host',
    href: '/settings/connector',
    x: 364,
    y: 160
  },
  {
    id: 'updater',
    icon: ['M16 10a6 6 0 1 1-1.8-4.3', 'M16 3.5v3.5h-3.5'],
    name: 'Updater',
    what: 'A scheduled task on the host: deploys GitHub main, rebuilds what changed and restarts containers when asked.',
    kind: 'host',
    href: '/settings/updates',
    log: 'updater.log',
    x: 668,
    y: 160
  },
  {
    id: 'web',
    icon: ['M4 4h4.5v4.5H4zM11.5 4H16v4.5h-4.5zM4 11.5h4.5V16H4zM11.5 11.5H16V16h-4.5z'],
    name: 'App',
    what: 'This web app: pages, apps, the chat, the MCP tools. Rebuilds itself when its code changes.',
    kind: 'container',
    href: '/settings/apps',
    log: 'web.log',
    service: 'web',
    restartNote: 'The page reloads; nothing is lost.',
    x: 364,
    y: 300
  },
  {
    id: 'db',
    icon: ['M4 5.5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2z', 'M4 5.5v9c0 1.1 2.7 2 6 2s6-.9 6-2v-9M4 10c0 1.1 2.7 2 6 2s6-.9 6-2'],
    name: 'Database',
    what: 'PostgreSQL: the data of the app and of every installed app, each in its own schema.',
    kind: 'container',
    href: '/settings/backups',
    x: 364,
    y: 520
  },
  {
    id: 'terminal',
    icon: ['M3.5 4.5h13v11h-13z', 'M6.5 8l2.5 2-2.5 2M10.5 12.5h3'],
    name: 'Terminal',
    what: 'Where Claude Code and Codex run: the chat, the terminal and the agents\' sign-ins.',
    kind: 'container',
    href: '/settings/ai',
    service: 'terminal',
    restartNote: 'Ends the Claude and Codex sessions and the terminal running there.',
    x: 60,
    y: 300
  },
  {
    id: 'browser',
    icon: ['M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z', 'M3 8h14'],
    name: 'Browser',
    what: 'A Chromium the agents drive and you can watch: for services without an API.',
    kind: 'container',
    href: '/settings/browser',
    service: 'browser',
    restartNote: 'Closes its open tabs; sign-ins stay.',
    x: 60,
    y: 410
  },
  {
    id: 'worker',
    icon: ['M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4'],
    name: 'Worker',
    what: 'Runs the installed apps\' background services and scheduled jobs; the only part that reads the host.',
    kind: 'container',
    href: '/settings/worker',
    log: 'worker.log',
    service: 'worker',
    restartNote: 'Its services start again; scheduled jobs keep their history.',
    x: 668,
    y: 300
  },
  {
    id: 'backup',
    icon: ['M10 3v9M6.5 8.5 10 12l3.5-3.5', 'M4 14v2.5h12V14'],
    name: 'Backups',
    what: 'Backs up the database, the settings and the apps every night, outside the checkout.',
    kind: 'container',
    href: '/settings/backups',
    log: 'backup.log',
    service: 'backup',
    x: 60,
    y: 520
  },
  {
    id: 'ext-migrate',
    icon: ['M4 6h9M10 3l3 3-3 3', 'M16 14H7M10 11l-3 3 3 3'],
    name: 'App migrations',
    what: 'Applies new database migrations of the app and the installed apps within seconds.',
    kind: 'container',
    href: '/settings/apps',
    log: 'ext-migrate.log',
    service: 'ext-migrate',
    x: 668,
    y: 520
  }
];

export interface Link {
  from: string;
  to: string;
  /** What goes over it, one short phrase. */
  label: string;
  /** Drawn dashed: control, not data (the updater deploying). */
  dashed?: boolean;
}

export const LINKS: Link[] = [
  { from: 'you', to: 'web', label: 'opens the app over the tailnet' },
  { from: 'claude', to: 'connector', label: 'MCP over the internet' },
  { from: 'connector', to: 'web', label: 'only /mcp' },
  { from: 'github', to: 'updater', label: 'main' },
  { from: 'updater', to: 'web', label: 'deploys and restarts', dashed: true },
  { from: 'web', to: 'terminal', label: 'chat and terminal' },
  { from: 'web', to: 'browser', label: 'screen' },
  { from: 'terminal', to: 'browser', label: 'drives it' },
  { from: 'web', to: 'db', label: 'data' },
  { from: 'worker', to: 'db', label: 'apps\' data' },
  { from: 'backup', to: 'db', label: 'backs up' },
  { from: 'ext-migrate', to: 'db', label: 'migrations' }
];

/** An installed app as the diagram knows it: from the registry and the worker's status, nothing hard-coded. */
export interface AppInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: 'native' | 'onefile';
  href: string;
  enabled: boolean;
  /** Services and jobs it runs in the worker, and how many of them fail. */
  units: number;
  failed: number;
}

const APP_ICON = ['M4 4h4.5v4.5H4zM11.5 4H16v4.5h-4.5zM4 11.5h4.5V16H4z', 'M13.75 11.5v4.5M11.5 13.75H16'];

/** The installed apps as parts of the diagram: a grid of rows under the containers. */
export function appParts(apps: AppInfo[]): Part[] {
  const gap = (VIEW_W - 2 * 60 - APPS_PER_ROW * NODE_W) / (APPS_PER_ROW - 1);
  return apps.map((a, i) => ({
    id: `app:${a.id}`,
    name: a.name,
    what: a.description,
    kind: 'app' as const,
    icon: APP_ICON,
    href: `/settings/extensions/${a.id}`,
    x: 60 + (i % APPS_PER_ROW) * (NODE_W + gap),
    y: APPS_Y + Math.floor(i / APPS_PER_ROW) * ROW_H
  }));
}

/** An app keeps its data in the database (its own schema, or the app's key-value store) and, when it runs
 * services or jobs, the worker runs them. The app serves its pages, which the detail card says. */
export function appLinks(apps: AppInfo[]): Link[] {
  return apps.flatMap((a) => [
    { from: `app:${a.id}`, to: 'db', label: 'its data' },
    ...(a.units ? [{ from: 'worker', to: `app:${a.id}`, label: 'runs its services', dashed: true }] : [])
  ]);
}

/** How tall the diagram is with this many apps. */
export const viewHeight = (apps: number): number => (apps ? APPS_Y + Math.ceil(apps / APPS_PER_ROW) * ROW_H - ROW_H + NODE_H + 22 : 604);

/** The parts a part uses (it needs them) and the parts that use it. */
export function neighbours(id: string, links: Link[] = LINKS): { uses: string[]; usedBy: string[] } {
  return {
    uses: links.filter((l) => l.from === id).map((l) => l.to),
    usedBy: links.filter((l) => l.to === id).map((l) => l.from)
  };
}

/**
 * An SVG path from one part to another. A part in a lower row: a vertical S-curve from the bottom of the
 * upper one to the top of the lower one. The same row: a straight line between facing sides. From the
 * worker down to an app: along the diagram's right edge, past the containers below it.
 */
export function linkPath(a: Part, b: Part): string {
  const ax = a.x + NODE_W / 2;
  const bx = b.x + NODE_W / 2;
  if (a.id === 'worker' && b.kind === 'app') {
    const x = VIEW_W - 14;
    const y1 = a.y + NODE_H / 2;
    const top = b.y - 18;
    return `M${a.x + NODE_W} ${y1} C${x} ${y1} ${x} ${y1} ${x} ${y1 + 30} L${x} ${top - 20} C${x} ${top} ${bx} ${top - 12} ${bx} ${b.y}`;
  }
  if (b.y >= a.y + NODE_H || a.y >= b.y + NODE_H) {
    const down = b.y > a.y;
    const y1 = down ? a.y + NODE_H : a.y;
    const y2 = down ? b.y : b.y + NODE_H;
    if (Math.abs(ax - bx) < 2) return `M${ax} ${y1} L${bx} ${y2}`;
    const mid = (y1 + y2) / 2;
    return `M${ax} ${y1} C${ax} ${mid} ${bx} ${mid} ${bx} ${y2}`;
  }
  const right = bx > ax;
  return `M${right ? a.x + NODE_W : a.x} ${a.y + NODE_H / 2} L${right ? b.x : b.x + NODE_W} ${b.y + NODE_H / 2}`;
}

/** The live state of a part (lib/server/infrastructure.ts). `state` picks the words the page shows. */
export type Health = 'good' | 'warning' | 'critical' | 'off';
export interface PartState {
  health: Health;
  state: string;
  /** A detail in words already (a message of the part itself), '' when none. */
  detail: string;
}
