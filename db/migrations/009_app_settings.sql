-- 009: app-wide settings from System settings that are not about one extension, as JSON per key.
-- First key: "languages" (spec 007), the languages the app offers and extensions are translated into.
CREATE TABLE IF NOT EXISTS core.app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
