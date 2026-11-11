-- 011: MCP addresses per profile and limits for the Claude connector (spec 005).
-- Each profile has MCP addresses (core.mcp_endpoints): a built-in one with every app, and its own ones,
-- each with a name, the apps it shows and whether it may change data. A connection (grant) belongs to
-- one address and follows its settings. Connections are approved in the app on the tailnet, not with
-- the app password on the public page (core.oauth_requests). Every tool call is logged (core.tool_calls).

CREATE TABLE IF NOT EXISTS core.mcp_endpoints (
  id         text PRIMARY KEY,                    -- in the address: /mcp/x/<id>
  profile_id text NOT NULL REFERENCES core.profiles (id) ON DELETE CASCADE,
  name       text NOT NULL,
  builtin    boolean NOT NULL DEFAULT false,      -- the profile's "everything" address; cannot be removed
  extensions text[],                              -- the apps it shows; NULL = every app, also later ones
  can_write  boolean NOT NULL DEFAULT false,      -- tools that change data (readOnly: false)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_endpoints_builtin ON core.mcp_endpoints (profile_id) WHERE builtin;

-- Every profile gets its built-in address (the app adds one for profiles made later).
INSERT INTO core.mcp_endpoints (id, profile_id, name, builtin, can_write)
  SELECT 'e' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), p.id, 'All apps', true, true
  FROM core.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM core.mcp_endpoints e WHERE e.profile_id = p.id AND e.builtin);

-- A connection belongs to a profile and an address; removing either removes it.
DELETE FROM core.oauth_grants g WHERE NOT EXISTS (SELECT 1 FROM core.profiles p WHERE p.id = g.profile_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_grants_profile_fk') THEN
    ALTER TABLE core.oauth_grants ADD CONSTRAINT oauth_grants_profile_fk
      FOREIGN KEY (profile_id) REFERENCES core.profiles (id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE core.oauth_grants ADD COLUMN IF NOT EXISTS endpoint_id text REFERENCES core.mcp_endpoints (id) ON DELETE CASCADE;
-- Connections made before addresses existed had everything: they become the built-in address's.
UPDATE core.oauth_grants g SET endpoint_id = e.id FROM core.mcp_endpoints e
  WHERE g.endpoint_id IS NULL AND e.profile_id = g.profile_id AND e.builtin;
ALTER TABLE core.oauth_grants ALTER COLUMN endpoint_id SET NOT NULL;

-- A hard end: refresh tokens no longer renew a connection forever.
ALTER TABLE core.oauth_grants ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE core.oauth_grants SET expires_at = created_at + interval '180 days' WHERE expires_at IS NULL;
ALTER TABLE core.oauth_grants ALTER COLUMN expires_at SET DEFAULT now() + interval '180 days';
ALTER TABLE core.oauth_grants ALTER COLUMN expires_at SET NOT NULL;

-- A connection waiting for the owner: filed by the public authorize page, decided in the profile's
-- settings. browser_hash ties it to the browser that asked, so only that browser picks up the code.
CREATE TABLE IF NOT EXISTS core.oauth_requests (
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
CREATE INDEX IF NOT EXISTS oauth_requests_expires ON core.oauth_requests (expires_at);

-- What the AI did through MCP: one row per tools/call. No arguments and no results are kept.
CREATE TABLE IF NOT EXISTS core.tool_calls (
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
CREATE INDEX IF NOT EXISTS tool_calls_at ON core.tool_calls (at);
