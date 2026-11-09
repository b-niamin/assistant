/** System settings -> Logs: every log of the app in one place (lib/server/logs.ts). Unlock first. */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { mergeLogs, readLogs } from '#lib/server/logs.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

const PER_FILE = 500;
const MERGED = 800;

export const load: PageServerLoad = async ({ cookies, url }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=logs');
  const { files, lines } = await readLogs();
  const file = url.searchParams.get('file') ?? '';
  const shown = files.includes(file) ? lines[file].slice(-PER_FILE) : mergeLogs(Object.values(lines), MERGED);
  return {
    files: files.map((f) => ({ name: f, lines: lines[f].length })),
    file: files.includes(file) ? file : '',
    lines: shown
  };
};
