import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pipElementScript, pipMarkup, themeTags, tokensOf } from './theme';

// Vitest turns CSS imports (even ?raw) into empty strings, so the tests read the real files.
const css = readFileSync(new URL('../../app.css', import.meta.url), 'utf8');
const svg = readFileSync(new URL('../../../static/pip.svg', import.meta.url), 'utf8');

describe('onefile theme', () => {
  it('takes only the token blocks of app.css', () => {
    const sample = ':root {\n  --ink: #000; /* note */\n}\n\n*,\n*::before { box-sizing: border-box; }\nbody { margin: 0; }';
    expect(tokensOf(sample)).toBe(':root {\n  --ink: #000; \n}');
  });

  it('inlines the real tokens, light and dark, in a layer', () => {
    const tags = themeTags(css, svg);
    expect(tags).toMatch(/^<style id="assistant-theme">@layer assistant \{ :root \{/);
    expect(tags).toContain('--accent:');
    expect(tags).toContain("[data-theme='dark']");
    expect(tags).not.toContain('box-sizing');
  });

  it('defines <assistant-pip> with the eyes wrapped for moods and no raw tags in the script', () => {
    const script = pipElementScript(pipMarkup('<svg viewBox="0 0 64 64" width="256" height="256"><title>Pip</title><circle fill="#fff" cx="24.6" cy="35" r="6.2"/><g fill="#fff"><circle cx="1"/></g></svg>'));
    expect(script).toContain("customElements.define('assistant-pip'");
    expect(script).not.toMatch(/<\/?(svg|style|script)/);
    const html = JSON.parse(/var html = (".*");/.exec(script)![1]);
    expect(html).toContain('<g class="body">');
    expect(html).toContain('<g class="eyes">');
    expect(html).not.toContain('width="256"');
    expect(html).not.toContain('<title>');
  });

  it('wraps the eyes of the real Pip too', () => {
    const tags = themeTags(css, svg);
    expect(tags).toContain('class=\\"eyes\\"');
    expect(tags).toContain('width=\\"64\\"'); // the headband rect keeps its size
  });
});
