/** What the shell knows about one installed extension at runtime (generated from the manifests). */
export interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  /** native: SvelteKit routes compiled into the shell. onefile: one HTML file in a sandboxed iframe. */
  kind: 'native' | 'onefile';
  /** profile: data belongs to the viewing profile. shared: one data set for everybody. */
  scope: 'profile' | 'shared';
  href: string;
  entry: string | null;
  /** Profiles that see it; null = every profile. */
  profiles: string[] | null;
  /** What Claude built it from (a repo, an app, an idea): a link or a short note. */
  inspiredBy: string | null;
  /** It ships web/routes/settings: an extra view at /<id>/settings, linked from its panel. */
  settingsPage: boolean;
  /** Fields of its panel in System settings (manifest "settings"; secrets included). */
  settings: SettingField[];
  /** Names of its secret fields; an admin sets the values (spec 004). */
  secrets: string[];
  /** What Beni wears on its pages (manifest "accessory", beni-accessories.ts); null = guessed from id and name. */
  accessory: string | null;
  /** Languages it has translations for (spec 007): always "en", plus each extensions/<id>/i18n/<lang>.json. */
  languages: string[];
  /** Switched off in System settings: gone from nav, routes and APIs, data kept. */
  enabled: boolean;
}

/** One field of an extension's settings panel (manifest "settings"). */
export interface SettingField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'secret';
  help?: string;
  options?: string[];
  default?: string | number | boolean;
  /** Secrets only: a list (calendar links, keys), one item per row with [x] and a [+] to add one. */
  multiple?: boolean;
}
