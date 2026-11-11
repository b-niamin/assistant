/**
 * MCP addresses of a profile (spec 005, migration 011), set in the profile's settings. Each is a URL
 * Claude connects to, /mcp/x/<id>: the built-in one shows every app of the profile and may change data;
 * the profile's own ones show the apps ticked for them, read only unless allowed. A connection follows
 * its address: changing the ticks changes what every connection on it sees at its next call.
 */
import { randomBytes } from 'node:crypto';
import { db } from '#lib/server/db.ts';

export interface McpEndpoint {
  id: string;
  profileId: string;
  name: string;
  builtin: boolean;
  /** The apps it shows; null = every app, also ones installed later. */
  extensions: string[] | null;
  canWrite: boolean;
}

export const ENDPOINT_ID_RE = /^e[a-z0-9]{20}$/;
export const ENDPOINT_PATH_RE = /^\/mcp\/x\/(e[a-z0-9]{20})$/;
const newId = () => 'e' + randomBytes(16).toString('hex').slice(0, 20);

type Row = { id: string; profile_id: string; name: string; builtin: boolean; extensions: string[] | null; can_write: boolean };
const toEndpoint = (r: Row): McpEndpoint => ({ id: r.id, profileId: r.profile_id, name: r.name, builtin: r.builtin, extensions: r.extensions, canWrite: r.can_write });

export async function getEndpoint(id: string): Promise<McpEndpoint | null> {
  if (!ENDPOINT_ID_RE.test(id)) return null;
  const [r] = await db()<Row[]>`SELECT id, profile_id, name, builtin, extensions, can_write FROM core.mcp_endpoints WHERE id = ${id}`;
  return r ? toEndpoint(r) : null;
}

/** The profile's addresses, the built-in one first (made here when the profile is newer than 011). */
export async function listEndpoints(profileId: string): Promise<McpEndpoint[]> {
  await db()`INSERT INTO core.mcp_endpoints (id, profile_id, name, builtin, can_write)
             SELECT ${newId()}, ${profileId}, 'All apps', true, true
             WHERE EXISTS (SELECT 1 FROM core.profiles WHERE id = ${profileId})
               AND NOT EXISTS (SELECT 1 FROM core.mcp_endpoints WHERE profile_id = ${profileId} AND builtin)`;
  const rows = await db()<Row[]>`
    SELECT id, profile_id, name, builtin, extensions, can_write FROM core.mcp_endpoints
    WHERE profile_id = ${profileId} ORDER BY builtin DESC, created_at`;
  return rows.map(toEndpoint);
}

export const cleanName = (s: unknown): string => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);

export async function createEndpoint(profileId: string, name: string, extensions: string[], canWrite: boolean): Promise<McpEndpoint> {
  const id = newId();
  await db()`INSERT INTO core.mcp_endpoints (id, profile_id, name, extensions, can_write)
             VALUES (${id}, ${profileId}, ${name}, ${extensions}, ${canWrite})`;
  return { id, profileId, name, builtin: false, extensions, canWrite };
}

/** Name, apps and writes of the profile's own address; the built-in one cannot be changed. */
export async function updateEndpoint(profileId: string, id: string, name: string, extensions: string[], canWrite: boolean): Promise<boolean> {
  const rows = await db()`UPDATE core.mcp_endpoints SET name = ${name}, extensions = ${extensions}, can_write = ${canWrite}
                          WHERE id = ${id} AND profile_id = ${profileId} AND NOT builtin RETURNING 1`;
  return rows.length > 0;
}

/** Removes the address and every connection made through it. */
export async function deleteEndpoint(profileId: string, id: string): Promise<boolean> {
  const rows = await db()`DELETE FROM core.mcp_endpoints WHERE id = ${id} AND profile_id = ${profileId} AND NOT builtin RETURNING 1`;
  return rows.length > 0;
}
