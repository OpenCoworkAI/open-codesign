import { describe, expect, it } from 'vitest';
import {
  createToolLoopGuard,
  TOOL_LOOP_HALT_REPEATS,
  TOOL_LOOP_MAX_CYCLE_LENGTH,
  TOOL_LOOP_WARN_REPEATS,
  type ToolLoopCall,
  type ToolLoopVerdict,
} from './tool-loop-guard';

const view = (path = 'App.jsx'): ToolLoopCall => ({
  name: 'str_replace_based_edit_tool',
  args: { command: 'view', path },
});
const edit = (n: number): ToolLoopCall => ({
  name: 'str_replace_based_edit_tool',
  args: { command: 'str_replace', path: 'App.jsx', old_str: `a${n}`, new_str: `b${n}` },
});
const preview: ToolLoopCall = { name: 'preview', args: { path: 'App.jsx' } };

function feed(calls: ToolLoopCall[]): ToolLoopVerdict[] {
  const guard = createToolLoopGuard();
  return calls.map((call) => guard.check(call));
}

function repeat(cycle: ToolLoopCall[], times: number): ToolLoopCall[] {
  return Array.from({ length: times }, () => cycle).flat();
}

describe('createToolLoopGuard', () => {
  it('allows fewer identical calls than the warn threshold', () => {
    const verdicts = feed(repeat([view()], TOOL_LOOP_WARN_REPEATS - 1));
    expect(verdicts.every((verdict) => verdict.action === 'ok')).toBe(true);
  });

  it('warns on a streak from the warn threshold and halts at the halt threshold', () => {
    const verdicts = feed(repeat([view()], TOOL_LOOP_HALT_REPEATS));
    expect(verdicts.map((verdict) => verdict.action)).toEqual([
      ...Array(TOOL_LOOP_WARN_REPEATS - 1).fill('ok'),
      ...Array(TOOL_LOOP_HALT_REPEATS - TOOL_LOOP_WARN_REPEATS).fill('warn'),
      'halt',
    ]);
    expect(verdicts.at(-1)).toEqual({
      action: 'halt',
      repeats: TOOL_LOOP_HALT_REPEATS,
      cycle: ['str_replace_based_edit_tool'],
    });
  });

  it('keeps counting calls the host blocked after a warning', () => {
    const guard = createToolLoopGuard();
    const verdicts = repeat([view()], TOOL_LOOP_HALT_REPEATS).map((call) => guard.check(call));
    const warned = verdicts.findIndex((verdict) => verdict.action === 'warn');
    expect(verdicts.slice(warned).map((verdict) => verdict.action)).toEqual([
      'warn',
      'warn',
      'halt',
    ]);
  });

  it('resets the streak when the arguments change', () => {
    const verdicts = feed([
      ...repeat([view()], TOOL_LOOP_WARN_REPEATS),
      view('Other.jsx'),
      ...repeat([view()], TOOL_LOOP_WARN_REPEATS - 1),
    ]);
    expect(verdicts.slice(0, TOOL_LOOP_WARN_REPEATS).at(-1)?.action).toBe('warn');
    expect(verdicts.slice(TOOL_LOOP_WARN_REPEATS).every((verdict) => verdict.action === 'ok')).toBe(
      true,
    );
  });

  it('treats the same arguments in another key order as the same call', () => {
    const verdicts = feed([
      { name: 'preview', args: { path: 'App.jsx', viewport: { width: 1, height: 2 } } },
      { name: 'preview', args: { viewport: { height: 2, width: 1 }, path: 'App.jsx' } },
      { name: 'preview', args: { path: 'App.jsx', viewport: { width: 1, height: 2 } } },
    ]);
    expect(verdicts.at(-1)?.action).toBe('warn');
  });

  it('keeps array order and tool name significant', () => {
    const steps = (order: string[]): ToolLoopCall => ({ name: 'preview', args: { order } });
    const verdicts = feed([
      steps(['a', 'b']),
      steps(['b', 'a']),
      steps(['a', 'b']),
      { name: 'other', args: { order: ['a', 'b'] } },
      steps(['a', 'b']),
    ]);
    expect(verdicts.every((verdict) => verdict.action === 'ok')).toBe(true);
  });

  it.each([2, 3])('detects a cycle of %i calls repeating unchanged', (length) => {
    const cycle = [view(), edit(1), preview].slice(0, length);
    const verdicts = feed(repeat(cycle, TOOL_LOOP_HALT_REPEATS));
    const firstWarn = verdicts.findIndex((verdict) => verdict.action !== 'ok');
    expect(firstWarn).toBe(TOOL_LOOP_WARN_REPEATS * length - 1);
    expect(verdicts[firstWarn]).toEqual({
      action: 'warn',
      repeats: TOOL_LOOP_WARN_REPEATS,
      cycle: cycle.map((call) => call.name),
    });
    expect(verdicts.at(-1)).toMatchObject({ action: 'halt', repeats: TOOL_LOOP_HALT_REPEATS });
    expect(verdicts.findIndex((verdict) => verdict.action === 'halt')).toBe(
      TOOL_LOOP_HALT_REPEATS * length - 1,
    );
  });

  it('does not look for cycles longer than the maximum', () => {
    const cycle = Array.from({ length: TOOL_LOOP_MAX_CYCLE_LENGTH + 1 }, (_, n) => edit(n));
    const verdicts = feed(repeat(cycle, TOOL_LOOP_HALT_REPEATS));
    expect(verdicts.every((verdict) => verdict.action === 'ok')).toBe(true);
  });

  it('breaks a cycle when one call in it changes', () => {
    const verdicts = feed([
      ...repeat([view(), edit(1)], TOOL_LOOP_WARN_REPEATS - 1),
      view(),
      edit(2),
      view(),
      edit(3),
    ]);
    expect(verdicts.every((verdict) => verdict.action === 'ok')).toBe(true);
  });

  it('allows a long design: many different edits with a repeated preview between them', () => {
    const calls = Array.from({ length: 60 }, (_, n) => [edit(n), preview]).flat();
    expect(feed(calls).every((verdict) => verdict.action === 'ok')).toBe(true);
  });

  it('does not count a block of one repeated call as a cycle', () => {
    const verdicts = feed(repeat([view()], TOOL_LOOP_WARN_REPEATS));
    expect(verdicts.at(-1)).toMatchObject({
      action: 'warn',
      cycle: ['str_replace_based_edit_tool'],
    });
  });

  it('forgets earlier calls after reset', () => {
    const guard = createToolLoopGuard();
    for (const call of repeat([view()], TOOL_LOOP_WARN_REPEATS)) guard.check(call);
    guard.reset();
    expect(guard.check(view())).toEqual({ action: 'ok' });
  });
});
