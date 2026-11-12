/**
 * What needs attention in System settings, for the sidebar's dots and the overview's tiles: the updater,
 * the backups, the worker and the Claude connector, read from the status files their services write.
 * Cheap (local files only): GitHub and the terminal container are asked by the pages that need them.
 */
import { backupStatus, buildStatus } from './backup.ts';
import { funnelStatus, updateView, updaterControl, updaterStatus, type UpdateState } from './updater.ts';
import { workerAlive, workerStatus } from './worker.ts';

/** A dot in the sidebar: attention (warning), broken (critical), something new (accent). */
export type Tone = 'good' | 'warning' | 'critical' | 'accent' | 'off';

export interface SettingsStatus {
  updates: { tone: Tone; state: UpdateState | 'none'; pendingRestart: string };
  backups: { tone: Tone; state: 'ok' | 'failed' | 'running' | 'stale' | 'none'; lastOk: string };
  worker: { tone: Tone; state: 'ok' | 'failed' | 'down' | 'none'; units: number; failed: number };
  connector: { tone: Tone; state: 'on' | 'off' | 'turning' | 'error' };
  build: { failed: boolean };
}

export async function settingsStatus(): Promise<SettingsStatus> {
  const [up, control, backup, worker, funnel, build] = await Promise.all([
    updaterStatus(),
    updaterControl(),
    backupStatus(),
    workerStatus(),
    funnelStatus(),
    buildStatus()
  ]);

  const view = up ? updateView(up, control) : null;
  const state = view?.state ?? 'none';
  const updates: SettingsStatus['updates'] = {
    state,
    pendingRestart: up?.pendingRestart ?? '',
    tone:
      state === 'stale' || state === 'failed'
        ? 'critical'
        : state === 'interrupted' || state === 'blocked' || state === 'updating' || up?.pendingRestart
          ? 'warning'
          : state === 'available'
            ? 'accent'
            : state === 'ok'
              ? 'good'
              : 'off'
  };

  const bstate = !backup ? 'none' : backup.status === 'running' ? 'running' : backup.status === 'failed' ? 'failed' : backup.stale ? 'stale' : 'ok';
  const backups: SettingsStatus['backups'] = {
    state: bstate,
    lastOk: backup?.lastOk ?? '',
    tone: bstate === 'failed' || bstate === 'stale' ? 'critical' : bstate === 'running' ? 'warning' : bstate === 'ok' ? 'good' : 'off'
  };

  const units = worker?.units ?? [];
  const failed = units.filter((u) => u.state === 'failed' || u.state === 'backoff').length;
  const wstate = !worker ? 'none' : !workerAlive(worker) ? 'down' : failed ? 'failed' : 'ok';
  const workerOut: SettingsStatus['worker'] = {
    state: wstate,
    units: units.length,
    failed,
    tone: wstate === 'down' || wstate === 'failed' ? 'critical' : wstate === 'ok' ? 'good' : 'off'
  };

  const want = control.funnel === 'on';
  const cstate = !want ? 'off' : funnel?.state === 'on' && funnel.url ? 'on' : funnel?.state === 'error' || funnel?.state === 'unavailable' ? 'error' : 'turning';
  const connector: SettingsStatus['connector'] = {
    state: cstate,
    tone: cstate === 'on' ? 'good' : cstate === 'error' ? 'critical' : cstate === 'turning' ? 'warning' : 'off'
  };

  return { updates, backups, worker: workerOut, connector, build: { failed: build?.status === 'failed' } };
}
