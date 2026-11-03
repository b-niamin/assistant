-- 001: core schema shared by every module.
CREATE SCHEMA IF NOT EXISTS core;
-- Shell secrets (app password hash, encrypted extension secrets). Claude's read-only role is denied it.
CREATE SCHEMA IF NOT EXISTS secrets;

-- One row per person whose data lives here. There are no user accounts: the whole app sits behind
-- one APP_PASSWORD and you pick a profile inside it. Every module table references core.profiles(id).
CREATE TABLE IF NOT EXISTS core.profiles (
  id          text PRIMARY KEY,           -- short slug, e.g. 'alex'
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Web sessions for the single app password (opaque id in an httpOnly cookie).
CREATE TABLE IF NOT EXISTS core.sessions (
  id          text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text,
  ip_address  text
);
