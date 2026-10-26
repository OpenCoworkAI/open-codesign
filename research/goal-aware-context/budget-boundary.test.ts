import { describe, expect, it } from 'vitest';
import { type CompleteModelInput, measureRequest } from './budget.js';

describe('text-only request boundary', () => {
  const request: CompleteModelInput = {
    systemPrompt: '',
    contextSections: [],
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    question: null,
  };
  const limits = { inputBudgetTokens: 100, contextWindowTokens: 200, reservedOutputTokens: 50 };
  const counter = { id: 'text-only@1', unit: 'tokens' as const, count: () => 1 };

  it('rejects unsupported top-level, message and tool fields before a text counter can undercount', () => {
    const invalid = [
      { ...request, images: ['unsupported image'] },
      { ...request, providerPayload: { imageTokens: 2000 } },
      { ...request, messages: [{ role: 'user', content: 'hello', images: ['unsupported image'] }] },
      {
        ...request,
        tools: [
          { name: 'edit', description: '', parameters: {}, vendorSchema: { huge: 'unknown' } },
        ],
      },
    ];
    for (const input of invalid)
      expect(() => measureRequest(input, limits, counter)).toThrow(/unknown|unsupported/i);
  });

  it.each([
    '@',
    'counter@',
    '@1',
    'counter',
  ])('rejects a counter ID without both name and version: %s', (id) => {
    expect(() => measureRequest(request, limits, { ...counter, id })).toThrow(/counter|version/i);
  });
});
