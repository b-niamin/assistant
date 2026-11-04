/**
 * Binds extension route modules to the shell: the generated stubs in src/routes/(extensions) call
 * these wrappers, which add the ExtensionContext (profile, scoped DB, KV) as a second argument.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { readSecret } from '$lib/server/extension-secrets';
import type { ExtActions, ExtensionContext, ExtHandler, ExtLoad, Sql } from '$lib/sdk';
import { kvAll, kvApply } from './kv.server';
import { readSettings } from './config.server';
import { EXTENSIONS, extensionById, visibleTo } from './registry.server';

const roleOf = (id: string) => `ext_${id.replace(/-/g, '_')}`;

export async function contextFor(id: string, event: Pick<RequestEvent, 'locals'>): Promise<ExtensionContext> {
  const profileId = event.locals.profileId;
  const ext = await extensionById(id);
  if (!ext || !visibleTo(ext, profileId)) throw error(404, 'Not found');
  const role = roleOf(ext.id);
  return {
    extension: ext,
    profileId,
    dataProfileId: ext.scope === 'shared' ? null : profileId,
    db: <T>(fn: (sql: Sql) => Promise<T>) =>
      db().begin(async (sql) => {
        // role names come from validated ids ([a-z0-9_]), so this is not an injection point.
        // EXTENSION_DB_ROLES=off is for local development against a database without the roles.
        if (env.EXTENSION_DB_ROLES !== 'off') await sql.unsafe(`SET LOCAL ROLE ${role}`);
        return fn(sql);
      }) as Promise<T>,
    secrets: { get: (name) => readSecret(ext, name) },
    settings: {
      all: () => readSettings(ext),
      get: async (name) => (await readSettings(ext))[name] ?? null
    },
    kv: {
      all: () => kvAll(ext, profileId),
      get: async (key) => (await kvAll(ext, profileId))[key] ?? null,
      set: (key, value) => kvApply(ext, profileId, { set: { [key]: value } }),
      remove: (key) => kvApply(ext, profileId, { remove: [key] })
    }
  };
}

function assertCompiledIn(id: string): void {
  if (!EXTENSIONS.some((e) => e.id === id)) throw new Error(`extension ${id} is not installed`);
}

export const bind = {
  load<T>(id: string, fn: ExtLoad<T>) {
    assertCompiledIn(id);
    return async (event: Parameters<ExtLoad<T>>[0]) => fn(event, await contextFor(id, event));
  },
  actions(id: string, actions: ExtActions) {
    assertCompiledIn(id);
    return Object.fromEntries(
      Object.entries(actions).map(([name, fn]) => [name, async (event: RequestEvent) => fn(event, await contextFor(id, event))])
    );
  },
  handler(id: string, fn: ExtHandler) {
    assertCompiledIn(id);
    return async (event: RequestEvent) => fn(event, await contextFor(id, event));
  }
};
