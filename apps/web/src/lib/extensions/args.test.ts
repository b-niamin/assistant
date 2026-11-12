import { describe, expect, it } from 'vitest';
import { argumentProblems, checkArguments, ToolError } from './args';
import type { ToolSchema } from './tools';

const log: ToolSchema = {
  type: 'object',
  properties: {
    day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    rpe: { type: 'integer', minimum: 1, maximum: 10 },
    note: { type: 'string', maxLength: 5 },
    kind: { enum: ['run', 'ride'] },
    sets: { type: 'array', maxItems: 2, items: { type: 'object', properties: { reps: { type: 'integer' } }, required: ['reps'] } },
    lights: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    weight: { type: 'number' },
    clear: { type: ['string', 'null'] }
  },
  required: ['day']
};

describe('tool arguments', () => {
  it('lets a good call through, extra fields too', () => {
    expect(argumentProblems(log, { day: '2026-11-12', rpe: 7, weight: 3, lights: ['a'], clear: null, extra: 1 })).toEqual([]);
    expect(argumentProblems(log, { day: '2026-11-12', lights: 'light.*' })).toEqual([]);
    expect(argumentProblems(undefined, { anything: 1 })).toEqual([]);
  });
  it('names every wrong field', () => {
    expect(argumentProblems(log, { rpe: 11, note: 'too long', kind: 'swim', day: 'today' })).toEqual([
      'day: must match ^\\d{4}-\\d{2}-\\d{2}$',
      'rpe: must be at most 10',
      'note: must be at most 5 characters',
      'kind: must be one of "run", "ride"'
    ]);
    expect(argumentProblems(log, {})).toEqual(['day: is required']);
    expect(argumentProblems(log, { day: '2026-11-12', rpe: 2.5, sets: [{}, { reps: 'x' }, {}], lights: 3 })).toEqual([
      'rpe: must be integer, got number',
      'sets: takes at most 2 items',
      'sets[0].reps: is required',
      'sets[1].reps: must be integer, got string',
      'sets[2].reps: is required',
      'lights: does not match any allowed form'
    ]);
  });
  it('throws a ToolError', () => {
    expect(() => checkArguments('health__log', log, {})).toThrow(ToolError);
    expect(() => checkArguments('health__log', log, {})).toThrow('invalid arguments for health__log: day: is required');
  });
});
