/**
 * Tools for the AI (spec 005): what Claude (the claude.ai connector, or Claude Code and Codex in the
 * terminal) can do with {{id}}, as `{{id}}__<tool>`. The shell adds `describe` and a read-only `query`.
 * The contract: a read-only `overview` (one call that sums up what the app holds now), and one tool per
 * write, which validates its input like the page's form does. Every tool says readOnly: true or false.
 */
import type { ExtTool } from '$shell';
import { addItem, listItems } from './lib/items.server';
import { cleanTitle } from './lib/validate';

export const tools: ExtTool[] = [
  {
    name: 'overview',
    title: 'Items',
    readOnly: true,
    description: 'Every item of {{name}} with its id, title and whether it is done, open ones first.',
    input: { type: 'object', properties: {} },
    run: (_args, ctx) => ctx.db(async (sql) => ({ items: await listItems(sql, ctx.dataProfileId) }))
  },
  {
    name: 'add_item',
    title: 'Add an item',
    readOnly: false,
    description: 'Add one item to {{name}}. Returns the items afterwards.',
    input: { type: 'object', properties: { title: { type: 'string', description: '1-200 characters' } }, required: ['title'] },
    run: (args, ctx) => {
      const title = cleanTitle(args.title);
      if (!title) throw new Error('title must be 1-200 characters');
      return ctx.db(async (sql) => {
        await addItem(sql, ctx.dataProfileId, title);
        return { items: await listItems(sql, ctx.dataProfileId) };
      });
    }
  }
];
