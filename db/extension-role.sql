-- Per-extension DB role (spec 002), applied by migrate.sh for every installed extension with a db/ folder.
-- Variables: :ext_schema (schema = extension id with - -> _), :ext_role (ext_<schema>).
-- The web app (app_rw) runs an extension's queries after `SET LOCAL ROLE ext_<id>`, so they can only reach
-- that extension's own schema and core.profiles. claude_ro may read the schema (data chat), agent_rw (the
-- agents in the terminal) read and write its rows.
SELECT format('CREATE ROLE %I NOLOGIN', :'ext_role')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'ext_role') \gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS %I', :'ext_schema') \gexec

SELECT format('GRANT USAGE ON SCHEMA core TO %I', :'ext_role') \gexec
SELECT format('GRANT SELECT ON core.profiles TO %I', :'ext_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', :'ext_schema', :'ext_role') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', :'ext_schema', :'ext_role') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', :'ext_schema', :'ext_role') \gexec
SELECT format('GRANT %I TO app_rw', :'ext_role') \gexec
-- Shell roles keep working on the schema as before (app_rw for shell-side reads, claude_ro for data chat).
SELECT format('GRANT USAGE ON SCHEMA %I TO app_rw, claude_ro, agent_rw', :'ext_schema') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_rw', :'ext_schema') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO claude_ro', :'ext_schema') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO agent_rw', :'ext_schema') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO agent_rw', :'ext_schema') \gexec

-- Claude's read-only `<id>__query` tool (spec 005) runs its SQL through this function, never as
-- app_rw after SET ROLE: a security-definer function cannot change role (set_config('role', ...) fails),
-- so the query stays ext_<id> however it is written. Multi-statement text is refused by RETURN QUERY.
SELECT format($f$CREATE OR REPLACE FUNCTION ext_query.%I(q text) RETURNS SETOF json
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = %I, pg_temp
  AS $body$ BEGIN RETURN QUERY EXECUTE 'SELECT row_to_json(_ext_query_row) FROM (' || q || E'\n) _ext_query_row'; END $body$$f$,
  :'ext_schema', :'ext_schema') \gexec
SELECT format('ALTER FUNCTION ext_query.%I(text) OWNER TO %I', :'ext_schema', :'ext_role') \gexec
SELECT format('REVOKE ALL ON FUNCTION ext_query.%I(text) FROM PUBLIC', :'ext_schema') \gexec
GRANT USAGE ON SCHEMA ext_query TO app_rw;
SELECT format('GRANT EXECUTE ON FUNCTION ext_query.%I(text) TO app_rw', :'ext_schema') \gexec

-- Tables named secret_* (e.g. a service's encrypted login tokens) are for the extension's background
-- service only: not the web app, not Claude, not the `<id>__query` tool.
SELECT format('REVOKE ALL ON %I.%I FROM %I, app_rw, claude_ro, agent_rw', schemaname, tablename, :'ext_role')
  FROM pg_tables WHERE schemaname = :'ext_schema' AND tablename LIKE 'secret\_%' \gexec

-- Background services (manifest "services", run from the extension's compose.yml) log in as
-- ext_<schema>_svc (password from db/migrate.sh: derived per role for the worker): the extension's own tables, secret_* included, and
-- core.profiles. :svc_role is empty for an extension without services.
SELECT format('CREATE ROLE %I LOGIN', :'svc_role')
  WHERE :'svc_role' <> '' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'svc_role') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'svc_role', :'svc_pw') WHERE :'svc_role' <> '' \gexec
SELECT format('ALTER ROLE %I SET search_path = %I, core', :'svc_role', :'ext_schema') WHERE :'svc_role' <> '' \gexec
SELECT format('GRANT %I TO %I', :'ext_role', :'svc_role') WHERE :'svc_role' <> '' \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO %I', schemaname, tablename, :'svc_role')
  FROM pg_tables WHERE :'svc_role' <> '' AND schemaname = :'ext_schema' AND tablename LIKE 'secret\_%' \gexec
