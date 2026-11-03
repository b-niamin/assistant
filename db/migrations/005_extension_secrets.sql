-- 005: secrets of native extensions (spec 004), e.g. a Home Assistant token. Encrypted with
-- AES-256-GCM under SECRETS_KEY (web container only). An extension can read only the
-- names its manifest declares, through ctx.secrets; the settings page shows the last 4 characters.
CREATE TABLE IF NOT EXISTS secrets.extension_secrets (
  extension_id text NOT NULL,
  name         text NOT NULL,
  ciphertext   text NOT NULL,
  key_hint     text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (extension_id, name)
);
