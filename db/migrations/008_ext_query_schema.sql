-- 008: home of the per-extension query functions behind Claude's `<id>__query` tool (spec 004, 005).
-- db/extension-role.sql creates one SECURITY DEFINER function per extension here, owned by ext_<id>.
-- The web app used to run that tool's SQL after `SET LOCAL ROLE ext_<id>` as app_rw, and a query could
-- climb back with set_config('role', 'none', true) + query_to_xml(...) and read core.sessions or the
-- secrets schema. Inside a security-definer function Postgres refuses any change of role.
CREATE SCHEMA IF NOT EXISTS ext_query;
REVOKE ALL ON SCHEMA ext_query FROM PUBLIC;
