import { expect, it, vi } from 'vitest';
vi.mock('$app/env/private', () => ({}));
import { partStates, serviceRestart, type Observed } from './infrastructure';
import { LINKS, PARTS } from '#lib/settings/infrastructure.ts';

const now = Date.parse('2026-11-16T10:00:00Z');
const base: Observed = {
  updater: null,
  control: { mode: 'auto', request: '', funnel: 'off' },
  funnel: null,
  backup: null,
  worker: null,
  build: null,
  terminal: { configured: true, reachable: true, claude: true, codex: false, gh: false, chat: true },
  browser: true,
  database: true,
  migrateLog: ''
};

it('tells a terminal from before the chat, one that waits for a restart, and one that is down', () => {
  expect(partStates(base, now).terminal).toMatchObject({ health: 'good', state: 'running' });
  expect(partStates({ ...base, terminal: { ...base.terminal, chat: false } }, now).terminal).toMatchObject({ health: 'warning', state: 'outdated' });
  expect(partStates({ ...base, terminal: { ...base.terminal, reachable: false } }, now).terminal.health).toBe('critical');
  expect(partStates({ ...base, database: false }, now).db).toMatchObject({ health: 'critical', state: 'down' });
  expect(partStates({ ...base, migrateLog: '[ext-migrate] migrate failed; fix it\n' }, now)['ext-migrate'].state).toBe('failed');
});

it('follows a restart of one service until the updater echoes it', () => {
  const c = { ...base.control, service: 'terminal@2026-11-16T09:59:30Z' };
  expect(serviceRestart(base.control, null, now)).toBeNull();
  expect(serviceRestart(c, null, now)?.state).toBe('pending');
  expect(serviceRestart(c, null, now + 10 * 60_000)?.state).toBe('unanswered');
  const echoed = { serviceRestart: c.service, serviceRestartResult: 'ok' } as never;
  expect(serviceRestart(c, echoed, now)).toEqual({ service: 'terminal', at: '2026-11-16T09:59:30Z', state: 'ok' });
});

it('links only parts that exist, and every part has a state', () => {
  const ids = new Set(PARTS.map((p) => p.id));
  for (const l of LINKS) expect(ids.has(l.from) && ids.has(l.to)).toBe(true);
  expect(Object.keys(partStates(base, now)).sort()).toEqual([...ids].sort());
});
