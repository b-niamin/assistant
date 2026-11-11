import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { keysIn } from '../../../scripts/extensions-lib.mjs';
import { normalizeLanguageSettings, pickLanguage } from './languages';
import { makeT, type Messages } from './translate';

const pl: Messages = {
  Save: 'Zapisz',
  'Hello, {name}': 'Cześć, {name}',
  '{n} sets': { one: '{n} seria', few: '{n} serie', many: '{n} serii', other: '{n} serii' }
};

describe('translate', () => {
  it('looks up the English text and fills in placeholders', () => {
    const t = makeT('pl', pl);
    expect(t('Save')).toBe('Zapisz');
    expect(t('Hello, {name}', { name: 'Ola' })).toBe('Cześć, Ola');
    expect(t.locale).toBe('pl-PL');
  });
  it('falls back to the English text, never a raw key', () => {
    expect(makeT('pl', pl)('Not translated')).toBe('Not translated');
    expect(makeT('en', pl)('Save')).toBe('Save');
  });
  it('picks Polish plural forms by count', () => {
    const t = makeT('pl', pl);
    expect([1, 2, 5, 22, 25].map((n) => t.n(n, '{n} set', '{n} sets'))).toEqual(['1 seria', '2 serie', '5 serii', '22 serie', '25 serii']);
    expect(makeT('en').n(1, '{n} set', '{n} sets')).toBe('1 set');
    expect(makeT('en').n(3, '{n} set', '{n} sets')).toBe('3 sets');
  });
  it('searches the dictionaries in order (extension first, then the shell)', () => {
    expect(makeT('pl', { Save: 'Zachowaj' }, pl)('Save')).toBe('Zachowaj');
    expect(makeT('pl', {}, pl)('Save')).toBe('Zapisz');
  });
});

describe('language settings', () => {
  it('keeps English on, known codes only, the default among the enabled', () => {
    expect(normalizeLanguageSettings({ enabled: ['pl', 'xx'], default: 'pl' })).toEqual({ enabled: ['en', 'pl'], default: 'pl' });
    expect(normalizeLanguageSettings({ enabled: ['pl'], default: 'de' })).toEqual({ enabled: ['en', 'pl'], default: 'en' });
    expect(normalizeLanguageSettings(null)).toEqual({ enabled: ['en'], default: 'en' });
  });
  it("uses this browser's pick only while it is offered", () => {
    const s = { enabled: ['en', 'pl'], default: 'pl' };
    expect(pickLanguage(s, 'en')).toBe('en');
    expect(pickLanguage(s, 'de')).toBe('pl');
    expect(pickLanguage(s, undefined)).toBe('pl');
  });
});

/** Every shell text in t('...') has a Polish translation, so the app never mixes languages. */
describe('shell translations', () => {
  const src = path.resolve(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        if (name !== 'generated' && name !== '(extensions)') walk(abs);
      } else if (/\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts')) files.push(abs);
    }
  };
  walk(src);
  const keys = new Set(files.flatMap((f) => keysIn(readFileSync(f, 'utf8')) as string[]));
  for (const file of readdirSync(path.join(__dirname, 'locales'))) {
    it(`${file} covers every text of the shell`, () => {
      const messages = JSON.parse(readFileSync(path.join(__dirname, 'locales', file), 'utf8'));
      expect([...keys].filter((k) => !(k in messages))).toEqual([]);
    });
  }
});
