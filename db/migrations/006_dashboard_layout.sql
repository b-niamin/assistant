-- 006: per-profile dashboard layout (spec 003): tile order and hidden tiles. No row = default order, shown.
CREATE TABLE IF NOT EXISTS core.dashboard_layout (
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  tile_key   text NOT NULL,                 -- '<extension>:<tile>', e.g. 'health:readiness'
  position   integer NOT NULL,
  hidden     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (profile_id, tile_key)
);
