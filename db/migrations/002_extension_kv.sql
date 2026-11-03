-- 002: shell storage for extensions (spec 002). Onefile extensions keep their localStorage here, native
-- ones small settings. profile_id NULL = data of a "shared" extension, visible to every profile.
CREATE TABLE IF NOT EXISTS core.extension_kv (
  extension_id text NOT NULL,
  profile_id   text REFERENCES core.profiles(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS extension_kv_owner_key_idx
  ON core.extension_kv (extension_id, profile_id, key) NULLS NOT DISTINCT;
