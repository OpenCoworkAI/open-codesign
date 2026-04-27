import { describe, expect, it, vi } from 'vitest';
import { type AskInput, type AskResult, makeAskTool, validateAskInput } from './ask';

describe('validateAskInput', () => {
  it('accepts a valid single-question payload', () => {
    expect(
      validateAskInput({
        questions: [{ id: 'q1', type: 'freeform', prompt: 'who are you?' }],
      }),
    ).toEqual({ ok: true });
  });
  it('rejects empty questions', () => {
    expect(validateAskInput({ questions: [] }).ok).toBe(false);
  });
  it('rejects more than 25 questions', () => {
    expect(
      validateAskInput({
        questions: Array.from({ length: 26 }, (_, i) => ({
          id: `q${i}`,
          type: 'freeform',
          prompt: 'x',
        })),
      }).ok,
    ).toBe(false);
  });
  it('rejects non-object', () => {
    expect(validateAskInput(null).ok).toBe(false);
    expect(validateAskInput('hi').ok).toBe(false);
  });

  it('rejects malformed question objects', () => {
    expect(
      validateAskInput({
        questions: [{ id: 'q1', type: 'freeform', prompt: 'who?', typo: true }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskInput({
        questions: [{ id: 'q1', type: 'text-options', prompt: 'style?', options: ['Only one'] }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskInput({
        questions: [{ id: 'q1', type: 'slider', prompt: 'density', min: 24, max: 8, step: 2 }],
      }).ok,
    ).toBe(false);
    expect(
      validateAskInput({
        questions: [
          { id: 'q1', type: 'freeform', prompt: 'one' },
          { id: 'q1', type: 'freeform', prompt: 'two' },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe('makeAskTool', () => {
  it('routes valid input through the bridge and surfaces the answers', async () => {
    const canned: AskResult = {
      status: 'answered',
      answers: [
        { questionId: 'q1', value: 'Minimal' },
        { questionId: 'q2', value: 16 },
      ],
    };
    const bridge = vi.fn(async (_input: AskInput) => canned);
    const tool = makeAskTool(bridge);
    const result = await tool.execute('call-1', {
      questions: [
        { id: 'q1', type: 'text-options', prompt: 'style?', options: ['Minimal', 'Bold'] },
        { id: 'q2', type: 'slider', prompt: 'density', min: 8, max: 24, step: 2 },
      ],
    });
    expect(bridge).toHaveBeenCalledOnce();
    expect(result.details).toEqual(canned);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'user answered 2 question(s)' });
  });

  it('short-circuits on invalid input (0 questions) without calling the bridge', async () => {
    const bridge = vi.fn(async () => ({ status: 'answered', answers: [] }) satisfies AskResult);
    const tool = makeAskTool(bridge);
    const result = await tool.execute('call-2', { questions: [] } as unknown as AskInput);
    expect(bridge).not.toHaveBeenCalled();
    expect(result.details).toEqual({ status: 'cancelled', answers: [] });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('invalid input');
  });
});
