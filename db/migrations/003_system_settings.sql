-- 003: System settings (spec 002): extension switches, apps installed from the web, settings unlock.

-- Per-extension switches set in System settings. No row = installed.json defaults (enabled, its profiles).
CREATE TABLE IF NOT EXISTS core.extension_settings (
  extension_id text PRIMARY KEY,
  enabled      boolean NOT NULL DEFAULT true,
  profiles     text[],                       -- NULL = every profile
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Onefile apps installed from the web UI (sandboxed, so installing them never runs code in the shell).
CREATE TABLE IF NOT EXISTS core.installed_apps (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  version      text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('profile', 'shared')),
  html         text NOT NULL,
  sha256       text NOT NULL,
  source_url   text NOT NULL,
  source_path  text NOT NULL,
  source_ref   text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);

-- Settings need the app password again ("sudo mode"): until when this session may change them.
ALTER TABLE core.sessions ADD COLUMN IF NOT EXISTS elevated_until timestamptz;

