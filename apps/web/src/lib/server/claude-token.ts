/** CLAUDE_TOOLS_TOKEN (spec 005): shared by web and the claude/terminal containers, 32+ characters. */
import { timingSafeEqual } from 'node:crypto';
import * as env from '$app/env/private';

export function claudeTokenMatches(header: string | null, token = env.CLAUDE_TOOLS_TOKEN ?? ''): boolean {
  if (token.length < 32 || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
