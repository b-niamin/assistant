/**
 * System settings -> Backups: the backup service's state (db/backup.sh writes it) and "Back up now".
 */
import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { tFor } from '#lib/i18n/index.ts';
import { backupStatus, requestBackup } from '#lib/server/backup.ts';
import { isElevated, SESSION_COOKIE } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ cookies }) => {
  if (!(await isElevated(cookies.get(SESSION_COOKIE)))) throw redirect(303, '/settings?next=backups');
  return { backup: await backupStatus() };
};

export const actions: Actions = {
  /** "Back up now": the backup service picks the request up within a minute (db/backup.sh). */
  backup: async ({ cookies, locals }) => {
    const t = tFor(locals.lang);
    if (!(await isElevated(cookies.get(SESSION_COOKIE)))) return fail(403, { error: t('Unlock first.') });
    await requestBackup();
    return { ok: t('Backing up: it starts within a minute.') };
  }
};
