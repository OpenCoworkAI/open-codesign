import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const completeMock = vi.fn();

vi.mock('@open-codesign/providers', () => ({
  complete: (...args: unknown[]) => completeMock(...args),
  completeWithRetry: (
    _model: unknown,
    _messages: unknown,
    _opts: unknown,
    _retryOpts: unknown,
    impl: (...args: unknown[]) => unknown,
  ) => impl(_model, _messages, _opts),
}));

import { generate } from './index';

const MODEL: ModelRef = { provider: 'anthropic', modelId: 'claude-sonnet-4-6' };

const SAMPLE_HTML = `<!doctype html><html lang="en"><body><h1>Hi</h1></body></html>`;

const RESPONSE = `Here is your design.

<artifact identifier="design-1" type="html" title="Hello world">
${SAMPLE_HTML}
</artifact>`;

afterEach(() => {
  completeMock.mockReset();
});

describe('generate()', () => {
  it('throws CodesignError on empty prompt', async () => {
    await expect(
      generate({ prompt: '   ', history: [], model: MODEL, apiKey: 'sk-test' }),
    ).rejects.toBeInstanceOf(CodesignError);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('extracts the artifact body and the surrounding text', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 12,
      outputTokens: 34,
      costUsd: 0.0001,
    });

    const result = await generate({
      prompt: 'design a meditation app',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });

    expect(result.artifacts).toHaveLength(1);
    const first = result.artifacts[0];
    if (!first) throw new Error('expected one artifact');
    expect(first.id).toBe('design-1');
    expect(first.type).toBe('html');
    expect(first.content.trim()).toBe(SAMPLE_HTML);
    expect(result.message).toContain('Here is your design.');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(34);
    expect(result.costUsd).toBeCloseTo(0.0001);
  });

  it('passes the design-generator system prompt by default', async () => {
    completeMock.mockResolvedValueOnce({
      content: RESPONSE,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    await generate({
      prompt: 'design a meditation app',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    });

    const messages = completeMock.mock.calls[0]?.[1] as ChatMessage[];
    const system = messages[0];
    if (!system) throw new Error('expected system message');
    expect(system.role).toBe('system');
    expect(system.content).toContain('open-codesign');
    expect(system.content).toContain('artifact');
  });

  it('throws CodesignError with OUTPUT_MISSING_ARTIFACT when the model returns no <artifact> tags', async () => {
    completeMock.mockResolvedValueOnce({
      content: 'Here is your design, but I forgot the artifact tags.',
      inputTokens: 5,
      outputTokens: 10,
      costUsd: 0,
    });

    const err = await generate({
      prompt: 'design a landing page',
      history: [],
      model: MODEL,
      apiKey: 'sk-test',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodesignError);
    expect((err as CodesignError).code).toBe('OUTPUT_MISSING_ARTIFACT');
  });
});
