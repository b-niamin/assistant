-- 001: the shell's schema (core, secrets, ext_query). Later changes are new numbered files, additive only.

-- Schema core: migrate.sh creates it first, for core.schema_migrations.
-- Shell secrets (app password hash, encrypted extension secrets). Claude's read-only role is denied it.
CREATE SCHEMA secrets;
-- Home of the per-extension query functions behind Claude's `<id>__query` tool (spec 004, 005).
-- db/extension-role.sql creates one SECURITY DEFINER function per extension here, owned by ext_<id>:
-- inside such a function Postgres refuses any change of role, so a query cannot climb back to app_rw
-- (set_config('role', ...)) and read core.sessions or the secrets schema.
CREATE SCHEMA ext_query;
REVOKE ALL ON SCHEMA ext_query FROM PUBLIC;

-- One row per person whose data lives here. There are no user accounts: the whole app sits behind
-- one app password and you pick a profile inside it. Every module table references core.profiles(id).
CREATE TABLE core.profiles (
  id          text PRIMARY KEY,           -- short slug, e.g. 'alex'
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Web sessions for the app password. id is "h:" + hex SHA-256 of the httpOnly cookie, so a copy of
-- the database (a backup) holds no working logins.
CREATE TABLE core.sessions (
  id             text PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  user_agent     text,
  ip_address     text,
  -- Settings need the app password again ("sudo mode"): until when this session may change them.
  elevated_until timestamptz
);

-- The app password hash (set by the first-run setup at /setup), unless APP_PASSWORD_HASH is in .env.
CREATE TABLE secrets.app_config (
  key        text PRIMARY KEY,                -- 'app_password_hash'
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- App-wide settings from System settings that are not about one extension, as JSON per key,
-- e.g. "languages" (spec 007), the languages the app offers and extensions are translated into.
CREATE TABLE core.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Extensions (spec 002) -------------------------------------------------------------------------------

-- Shell storage for extensions. Onefile extensions keep their localStorage here, native ones small
-- settings. profile_id NULL = data of a "shared" extension, visible to every profile. Every key has a
-- version: a save over a key someone else changed since (another device, Claude through MCP) is
-- refused (409) instead of silently overwriting it.
CREATE TABLE core.extension_kv (
  extension_id text NOT NULL,
  profile_id   text REFERENCES core.profiles(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX extension_kv_owner_key_idx
  ON core.extension_kv (extension_id, profile_id, key) NULLS NOT DISTINCT;

-- Per-extension switches set in System settings. No row = installed.json defaults (enabled, its profiles).
CREATE TABLE core.extension_settings (
  extension_id text PRIMARY KEY,
  enabled      boolean NOT NULL DEFAULT true,
  profiles     text[],                       -- NULL = every profile
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Values of the fields an extension declares in its manifest "settings" (its panel in System settings).
-- One set per extension, for everybody. Secret fields are not here: secrets.extension_secrets.
CREATE TABLE core.extension_config (
  extension_id text NOT NULL,
  name         text NOT NULL,
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, name)
);

-- Secrets of native extensions (spec 004), e.g. a Home Assistant token. Encrypted with AES-256-GCM
-- under SECRETS_KEY (web container only). An extension can read only the names its manifest declares,
-- through ctx.secrets; the settings page shows the last 4 characters.
CREATE TABLE secrets.extension_secrets (
  extension_id text NOT NULL,
  name         text NOT NULL,
  ciphertext   text NOT NULL,
  key_hint     text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, name)
);

-- Onefile apps installed from the web UI (sandboxed, so installing them never runs code in the shell).
CREATE TABLE core.installed_apps (
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

-- Per-profile dashboard layout (spec 003): tile order and hidden tiles. No row = default order, shown.
CREATE TABLE core.dashboard_layout (
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  tile_key   text NOT NULL,                 -- '<extension>:<tile>', e.g. 'health:readiness'
  position   integer NOT NULL,
  hidden     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (profile_id, tile_key)
);

-- The Claude connector (spec 005) -------------------------------------------------------------------
-- The public MCP endpoint speaks OAuth 2.1. Clients register themselves (dynamic client registration);
-- the owner approves each connection in the app on the tailnet. Codes and tokens are stored as SHA-256
-- hashes only; claude_ro cannot read these tables (roles.sql).

-- Each profile has MCP addresses: a built-in one with every app (the app creates it with the profile),
-- and its own ones, each with a name, the apps it shows and whether it may change data.
CREATE TABLE core.mcp_endpoints (
  id         text PRIMARY KEY,                    -- in the address: /mcp/x/<id>
  profile_id text NOT NULL REFERENCES core.profiles (id) ON DELETE CASCADE,
  name       text NOT NULL,
  builtin    boolean NOT NULL DEFAULT false,      -- the profile's "everything" address; cannot be removed
  extensions text[],                              -- the apps it shows; NULL = every app, also later ones
  can_write  boolean NOT NULL DEFAULT false,      -- tools that change data (readOnly: false)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_endpoints_builtin ON core.mcp_endpoints (profile_id) WHERE builtin;

CREATE TABLE core.oauth_clients (
  id            text PRIMARY KEY,                 -- client_id, random
  name          text NOT NULL,
  redirect_uris text[] NOT NULL,
  secret_hash   text,                             -- NULL: a public client (PKCE only)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per approval: a connection of one profile through one address, which follows its settings.
-- The owner sees it in the settings and can remove it; removing the profile or the address removes it.
CREATE TABLE core.oauth_grants (
  id           text PRIMARY KEY,
  client_id    text NOT NULL REFERENCES core.oauth_clients (id) ON DELETE CASCADE,
  profile_id   text NOT NULL CONSTRAINT oauth_grants_profile_fk REFERENCES core.profiles (id) ON DELETE CASCADE,
  endpoint_id  text NOT NULL REFERENCES core.mcp_endpoints (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  -- A hard end: refresh tokens do not renew a connection forever.
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '180 days'
);

-- Authorization codes (single use, minutes) and access/refresh tokens, all hashed.
CREATE TABLE core.oauth_tokens (
  hash           text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  grant_id       text NOT NULL REFERENCES core.oauth_grants (id) ON DELETE CASCADE,
  redirect_uri   text,                            -- codes: must match at the token endpoint
  code_challenge text,                            -- codes: PKCE S256
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE INDEX oauth_tokens_grant ON core.oauth_tokens (grant_id);
CREATE INDEX oauth_tokens_expires ON core.oauth_tokens (expires_at);

-- A connection waiting for the owner: filed by the public authorize page, decided in the profile's
-- settings. browser_hash ties it to the browser that asked, so only that browser picks up the code.
CREATE TABLE core.oauth_requests (
  id             text PRIMARY KEY,
  user_code      text NOT NULL,                   -- shown on both pages, to match them up
  browser_hash   text NOT NULL,
  client_id      text NOT NULL REFERENCES core.oauth_clients (id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  state          text NOT NULL DEFAULT '',
  code_challenge text NOT NULL,
  asked_endpoint text REFERENCES core.mcp_endpoints (id) ON DELETE SET NULL,  -- the address the client used
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  decision       text CHECK (decision IN ('allow', 'deny')),
  endpoint_id    text REFERENCES core.mcp_endpoints (id) ON DELETE CASCADE,     -- the owner's pick
  done_at        timestamptz                      -- the code (or the denial) was handed out
);
CREATE INDEX oauth_requests_expires ON core.oauth_requests (expires_at);

-- What the AI did through MCP: one row per tools/call. No arguments and no results are kept.
CREATE TABLE core.tool_calls (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL CHECK (source IN ('connector', 'terminal')),
  grant_id    text,                               -- kept after the connection is removed
  endpoint    text,                               -- the address's name at the time
  client      text,
  profile_id  text NOT NULL,
  tool        text NOT NULL,
  ok          boolean NOT NULL,
  error       text,
  ms          integer NOT NULL
);
CREATE INDEX tool_calls_at ON core.tool_calls (at);
