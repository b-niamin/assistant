/** Data access for {{id}}. Every function takes the scoped `sql` from ctx.db. */
import type { Sql } from '$shell';

export interface Item {
  id: number;
  title: string;
  done: boolean;
}

/** owner = ctx.dataProfileId: a profile id for scope "profile", null for scope "shared". */
export async function listItems(sql: Sql, owner: string | null): Promise<Item[]> {
  return owner === null
    ? sql<Item[]>`SELECT id, title, done FROM {{schema}}.items ORDER BY done, created_at DESC`
    : sql<Item[]>`SELECT id, title, done FROM {{schema}}.items WHERE profile_id = ${owner} ORDER BY done, created_at DESC`;
}

export async function addItem(sql: Sql, owner: string | null, title: string): Promise<void> {
  if (owner === null) await sql`INSERT INTO {{schema}}.items (title) VALUES (${title})`;
  else await sql`INSERT INTO {{schema}}.items (profile_id, title) VALUES (${owner}, ${title})`;
}
