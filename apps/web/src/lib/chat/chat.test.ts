import { describe, expect, it } from 'vitest';
import { apply, emptyView, openAsks, type ChatEvent } from './events';
import { markdown } from './markdown';

describe('chat view', () => {
  it('builds messages, tool calls with results and approval cards from the events', () => {
    const events: ChatEvent[] = [
      { t: 'user', text: 'hi', n: 0 },
      { t: 'delta', text: 'Hel' },
      { t: 'text', text: 'Hello', n: 1 },
      { t: 'tool', id: 't1', name: 'Bash', summary: 'ls', n: 2 },
      { t: 'result', id: 't1', error: false, text: 'a', n: 3 },
      { t: 'ask', rid: 'r1', tool: 'Bash', summary: 'git push origin main', n: 4 },
      { t: 'tool', id: 't2', name: 'AskUserQuestion', summary: '{}', n: 5 },
      { t: 'ask', rid: 'r2', tool: 'AskUserQuestion', summary: '', questions: [{ question: 'Q?', header: '', multi: false, options: [] }], n: 6 }
    ];
    const v = events.reduce(apply, emptyView());
    expect(v.items.map((i) => i.kind)).toEqual(['user', 'text', 'tool', 'ask', 'ask']);
    expect(v.items[2]).toMatchObject({ result: { error: false, text: 'a' } });
    expect(v.live).toBe('');
    expect(v.busy).toBe(true);
    expect(openAsks(v)).toBe(2);
    apply(v, { t: 'answer', rid: 'r1', allow: false, n: 7 });
    apply(v, { t: 'expired', rid: 'r2', n: 8 });
    expect(v.items.filter((i) => i.kind === 'ask').map((i) => i.kind === 'ask' && i.state)).toEqual(['denied', 'expired']);
    apply(v, { t: 'done', cost: 0, n: 9 });
    expect(v.busy).toBe(false);
    expect(v.next).toBe(10);
  });
  it('ignores events it already has (a reconnect replays from `next`)', () => {
    const v = apply(emptyView(), { t: 'user', text: 'a', n: 0 });
    apply(v, { t: 'user', text: 'a', n: 0 });
    expect(v.items).toHaveLength(1);
  });
});

describe('markdown', () => {
  it('escapes HTML and renders the common bits', () => {
    expect(markdown('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
    expect(markdown('**a** and `b<c>` *d*')).toBe('<p><strong>a</strong> and <code>b&lt;c&gt;</code> <em>d</em></p>');
    expect(markdown('- one\n- two\n\n1. x')).toBe('<ul><li>one</li><li>two</li></ul><ol><li>x</li></ol>');
    expect(markdown('```sh\nrm <x>\n```')).toBe('<pre><code>rm &lt;x&gt;</code></pre>');
    expect(markdown('## Title')).toBe('<h4>Title</h4>');
    expect(markdown('[gh](https://github.com) [bad](javascript:alert(1))')).toBe(
      '<p><a href="https://github.com" target="_blank" rel="noreferrer noopener">gh</a> [bad](javascript:alert(1))</p>'
    );
  });
});
