/**
 * Data sources of one extension (spec 002, "Connected accounts"), for its panel in System settings:
 * runs the extension's web/sources.server.ts as the viewing profile and clamps what comes back.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { contextFor } from './runtime.server';
import { SOURCE_MODULES } from './generated/sources.server';
import { normalizeSources, type ExtSources, type SourceActionInput, type SourcesResult } from './sources';
import type { ExtensionInfo } from './types';
import { saveSettings } from './config.server';
import { deleteSecret, readSecret, setSecret } from '#lib/server/extension-secrets.ts';
import { addItems, itemHint, removeItem, splitItems } from './secret-items';

const TIMEOUT_MS = 4000;

export const hasSources = (ext: ExtensionInfo) => ext.kind === 'native' && ext.id in SOURCE_MODULES;

async function moduleOf(ext: ExtensionInfo): Promise<ExtSources | null> {
  const loader = SOURCE_MODULES[ext.id];
  if (!loader) return null;
  const mod = await loader();
  return mod.sources && typeof mod.sources.list === 'function' ? mod.sources : null;
}

/** Never throws: a broken or slow extension shows a note instead of its accounts. */
export async function sourcesOf(ext: ExtensionInfo, event: Pick<RequestEvent, 'locals'>): Promise<SourcesResult | null> {
  if (!hasSources(ext)) return null;
  let ctx;
  try {
    ctx = await contextFor(ext.id, event);
  } catch {
    return { ok: false, reason: 'hidden' }; // off, or not visible to this profile
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SourcesResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), TIMEOUT_MS);
  });
  const work = (async (): Promise<SourcesResult> => {
    try {
      const mod = await moduleOf(ext);
      return { ok: true, sources: mod ? normalizeSources(await mod.list(ctx)) : [] };
    } catch (e) {
      console.error(`settings: sources of ${ext.id} failed:`, e instanceof Error ? e.message : e);
      return { ok: false, reason: 'error' };
    }
  })();
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Runs an action the source offers right now (checked against its own list). Throws Error with a message for the owner. */
export async function runSourceAction(
  ext: ExtensionInfo,
  event: Pick<RequestEvent, 'locals'>,
  source: string,
  action: string,
  input: SourceActionInput
): Promise<string> {
  const mod = await moduleOf(ext);
  if (!mod?.act) throw new Error('This extension has no actions.');
  const ctx = await contextFor(ext.id, event);
  const offered = normalizeSources(await mod.list(ctx))
    .find((s) => s.id === source)
    ?.actions?.find((a) => a.id === action);
  if (!offered || offered.disabled) throw new Error('That action is not available now.');
  if (offered.date) {
    const d = input.date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error('Pick a date.');
    if ((offered.date.min && d < offered.date.min) || (offered.date.max && d > offered.date.max)) throw new Error('That date is out of range.');
  }
  return (await mod.act(ctx, source, action, offered.date ? { date: input.date } : {})) || 'Done.';
}

/**
 * Saves the settings fields a source edits in its own card (its `fields`, checked against its own list
 * and the manifest): plain values as in the Settings section, secrets only when a new value was typed.
 * Then, if the extension has `act`, runs `act(ctx, source, 'saved', {})` so it can check the connection;
 * its answer is the confirmation. Throws Error with a message for the owner.
 */
export async function saveSourceFields(
  ext: ExtensionInfo,
  event: Pick<RequestEvent, 'locals'>,
  source: string,
  form: FormData
): Promise<string> {
  const mod = await moduleOf(ext);
  if (!mod) throw new Error('This extension has no accounts.');
  const ctx = await contextFor(ext.id, event);
  const names = normalizeSources(await mod.list(ctx)).find((s) => s.id === source)?.fields ?? [];
  const fields = ext.settings.filter((f) => names.includes(f.name) && ['text', 'number', 'secret'].includes(f.type));
  if (!fields.length) throw new Error('Nothing to save here.');
  const plainNames = fields.filter((f) => f.type !== 'secret').map((f) => f.name);
  if (plainNames.length) await saveSettings(ext, form, plainNames);
  // A list (manifest "multiple"): the card's [x] sends `remove` (the field) and `index`; nothing else changes.
  const removing = fields.find((f) => f.multiple && f.name === form.get('remove'));
  if (removing) {
    const left = removeItem(await readSecret(ext, removing.name), Number(form.get('index')));
    if (left) await setSecret(ext, removing.name, left);
    else await deleteSecret(ext, removing.name);
    return 'Removed.';
  }
  for (const f of fields.filter((f) => f.type === 'secret')) {
    const v = form.get(`field:${f.name}`)?.toString().trim() ?? '';
    if (v) await setSecret(ext, f.name, f.multiple ? addItems(await readSecret(ext, f.name), v) : v);
  }
  if (!mod.act) return 'Saved.';
  try {
    return (await mod.act(await contextFor(ext.id, event), source, 'saved', {})) || 'Saved.';
  } catch (e) {
    throw new Error(`Saved, but: ${(e as Error).message}`);
  }
}

/** For the card: each item of every list secret ("multiple"), by its hint only, in stored order. */
export async function secretItemHints(ext: ExtensionInfo): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const f of ext.settings.filter((f) => f.type === 'secret' && f.multiple)) {
    out[f.name] = splitItems(await readSecret(ext, f.name).catch(() => null)).map(itemHint);
  }
  return out;
}
