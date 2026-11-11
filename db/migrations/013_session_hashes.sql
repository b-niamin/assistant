-- 013: sessions are stored as a hash of the cookie (audit report S2). A copy of the database (a backup)
-- no longer holds working logins. Ids hashed here get the same "h:" + hex SHA-256 the app computes.
UPDATE core.sessions SET id = 'h:' || encode(sha256(convert_to(id, 'UTF8')), 'hex') WHERE id NOT LIKE 'h:%';
