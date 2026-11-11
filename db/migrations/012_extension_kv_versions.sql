-- 012: a version per extension key (audit report I3). The onefile host sends the versions its app
-- loaded with; a save over a key someone else changed since (another device, Claude through MCP) is
-- refused (409) instead of silently overwriting it, and the app reloads with the newer data.
ALTER TABLE core.extension_kv ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
