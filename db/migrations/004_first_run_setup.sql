-- 004: first-run setup from the web (spec 002, "Install"). The app password hash can live here instead of
-- APP_PASSWORD_HASH in .env. In `secrets`, so Claude's read-only role cannot see it.
CREATE TABLE IF NOT EXISTS secrets.app_config (
  key        text PRIMARY KEY,                -- 'app_password_hash'
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
