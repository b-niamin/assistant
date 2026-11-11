-- Least-privilege roles, re-applied on every `migrate` run (idempotent).
--   app_rw     web app: read/write core + extension schemas, no secrets but its own two tables
--   claude_ro  Claude's data chat: SELECT on core + extension schemas, NO secrets, no writes
--   agent_rw   the agents in the terminal: read/write data of core + extension schemas; no DDL, no
--              TRUNCATE, no secrets, no sessions or connector tokens (same password as claude_ro)
-- Extension roles (ext_<id>, ext_<id>_svc for background services) come from db/extension-role.sql.
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['app_rw','claude_ro','agent_rw']) r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
ALTER ROLE app_rw    PASSWORD :'app_pw';
ALTER ROLE claude_ro PASSWORD :'claude_pw';
ALTER ROLE agent_rw  PASSWORD :'claude_pw';

ALTER ROLE app_rw    SET search_path = core;
ALTER ROLE claude_ro SET search_path = core;
-- Claude's queries can never write, even if a statement tries to.
ALTER ROLE claude_ro SET default_transaction_read_only = on;
ALTER ROLE claude_ro SET statement_timeout = '30s';
ALTER ROLE agent_rw  SET search_path = core;
ALTER ROLE agent_rw  SET statement_timeout = '60s';

GRANT USAGE ON SCHEMA core TO app_rw, claude_ro, agent_rw;
REVOKE ALL ON SCHEMA secrets FROM app_rw, claude_ro, agent_rw;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO app_rw;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA core TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA core TO claude_ro;
REVOKE SELECT ON core.sessions FROM claude_ro;
-- The Claude connector's OAuth state (migration 010): hashes only, still nothing for a data chat.
REVOKE SELECT ON core.oauth_clients, core.oauth_grants, core.oauth_tokens, core.oauth_requests FROM claude_ro;
-- The agents: every row of core, but not who is logged in, the connector's tokens or the migration log.
-- Not the owner of anything, so no DROP/ALTER/CREATE; TRUNCATE is not granted. Deletes are asked for in
-- the terminal (docker/terminal/beni-guard.mjs) and undone from the nightly backup.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO agent_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core TO agent_rw;
REVOKE ALL ON core.sessions, core.oauth_clients, core.oauth_grants, core.oauth_tokens, core.oauth_requests FROM agent_rw;
REVOKE INSERT, UPDATE, DELETE ON core.schema_migrations FROM agent_rw;
-- The connector's addresses and their log (migration 011) are security settings: read, not change.
REVOKE INSERT, UPDATE, DELETE ON core.mcp_endpoints, core.tool_calls FROM agent_rw;
-- The web app may use two tables in `secrets`: extension secrets (encrypted; spec 004) and the app
-- password hash.
GRANT USAGE ON SCHEMA secrets TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON secrets.extension_secrets TO app_rw;
GRANT SELECT, INSERT, UPDATE ON secrets.app_config TO app_rw;

-- Extension schemas get their grants from db/extension-role.sql (applied by migrate.sh).
