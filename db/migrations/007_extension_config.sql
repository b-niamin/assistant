-- 007: values of the fields an extension declares in its manifest "settings" (its panel in System
-- settings). One set per extension, for everybody. Secret fields are not here: secrets.extension_secrets.
CREATE TABLE IF NOT EXISTS core.extension_config (
  extension_id text NOT NULL,
  name         text NOT NULL,
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, name)
);
