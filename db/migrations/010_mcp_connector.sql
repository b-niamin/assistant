-- 010: the Claude connector (spec 005): OAuth 2.1 for the public MCP endpoint /mcp.
-- Clients register themselves (dynamic client registration); a person approves each one with the app
-- password. Codes and tokens are stored as SHA-256 hashes only; claude_ro cannot read these tables (roles.sql).

CREATE TABLE IF NOT EXISTS core.oauth_clients (
  id            text PRIMARY KEY,                 -- client_id, random
  name          text NOT NULL,
  redirect_uris text[] NOT NULL,
  secret_hash   text,                             -- NULL: a public client (PKCE only)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per approval: a connection the owner sees in System settings and can remove.
CREATE TABLE IF NOT EXISTS core.oauth_grants (
  id           text PRIMARY KEY,
  client_id    text NOT NULL REFERENCES core.oauth_clients (id) ON DELETE CASCADE,
  profile_id   text NOT NULL,                     -- the default profile for its tool calls
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Authorization codes (single use, minutes) and access/refresh tokens, all hashed.
CREATE TABLE IF NOT EXISTS core.oauth_tokens (
  hash           text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  grant_id       text NOT NULL REFERENCES core.oauth_grants (id) ON DELETE CASCADE,
  redirect_uri   text,                            -- codes: must match at the token endpoint
  code_challenge text,                            -- codes: PKCE S256
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON core.oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON core.oauth_tokens (expires_at);
