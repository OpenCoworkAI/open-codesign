import { describe, expect, it } from 'vitest';
import {
  assertWithinBudget,
  type CompleteModelInput,
  estimateUtf8QuarterTokens,
  measureRequest,
  type TokenCounter,
} from './budget.js';

const request: CompleteModelInput = {
  systemPrompt: '遵守限制🙂',
  contextSections: ['已确认：保留导航'],
  messages: [{ role: 'user', content: '仅修改按钮' }],
  tools: [
    { name: 'edit', description: '局部修改', parameters: { type: 'object', required: ['path'] } },
  ],
  question: '当前限制是什么？',
};
const limits = { inputBudgetTokens: 100, contextWindowTokens: 150, reservedOutputTokens: 50 };
const counter = (count: number | null): TokenCounter => ({
  id: 'test-counter@1',
  unit: 'tokens',
  count: () => count,
});

describe('complete request budget protocol', () => {
  it('includes system, brief, history, tools and the reader question including CJK/emoji', () => {
    const measured = measureRequest(request, limits, estimateUtf8QuarterTokens);
    const components: CompleteModelInput[] = [
      { ...request, systemPrompt: '' },
      { ...request, contextSections: [] },
      { ...request, messages: [] },
      { ...request, tools: [] },
      { ...request, question: null },
    ];
    for (const reduced of components) {
      expect(measureRequest(reduced, limits, estimateUtf8QuarterTokens).count).toBeLessThan(
        measured.count ?? 0,
      );
    }
    expect(measured.unit).toBe('estimate');
    expect(measured.counterId).toContain('@');
  });

  it('passes the entire request to an injected model-aware counter', () => {
    const exact: TokenCounter = {
      id: 'fixture-model-framing@1',
      unit: 'tokens',
      count: (input) => {
        expect(input).toEqual(request);
        return 90;
      },
    };
    expect(measureRequest(request, limits, exact)).toMatchObject({
      unit: 'tokens',
      count: 90,
      counterId: 'fixture-model-framing@1',
      overflow: false,
      status: 'within-budget',
    });
  });

  it('counts exact boundary as valid and one token over as overflow', () => {
    expect(measureRequest(request, limits, counter(100)).overflow).toBe(false);
    const over = measureRequest(request, limits, counter(101));
    expect(over.status).toBe('overflow');
    expect(() => assertWithinBudget(over)).toThrow(/overflow/i);
  });

  it('reserves output space inside the model context limit', () => {
    const result = measureRequest(request, { ...limits, inputBudgetTokens: 120 }, counter(101));
    expect(result.inputLimitTokens).toBe(100);
    expect(result.overflow).toBe(true);
  });

  it('retains unknown counts as null and fails closed', () => {
    for (const missing of [undefined, counter(null)]) {
      const result = measureRequest(request, limits, missing);
      expect(result.count).toBeNull();
      expect(result.unit).toBe('unavailable');
      expect(result.status).toBe('unavailable');
      expect(() => assertWithinBudget(result)).toThrow(/unavailable/i);
    }
  });

  it('reports a failing counter without inventing a count', () => {
    const result = measureRequest(request, limits, {
      id: 'broken@1',
      unit: 'tokens',
      count: () => {
        throw new Error('tokenizer unavailable');
      },
    });
    expect(result).toMatchObject({ count: null, status: 'unavailable', counterId: 'broken@1' });
    expect(result.error).toContain('tokenizer unavailable');
  });

  it.each([-1, NaN, Infinity, 1.5])('rejects invalid counter result %s', (count) => {
    expect(() => measureRequest(request, limits, counter(count))).toThrow(/count/i);
  });

  it.each([
    { ...limits, inputBudgetTokens: 0 },
    { ...limits, contextWindowTokens: Infinity },
    { ...limits, reservedOutputTokens: -1 },
    { ...limits, reservedOutputTokens: 150 },
  ])('rejects invalid limits', (invalid) => {
    expect(() => measureRequest(request, invalid, counter(0))).toThrow(
      /limit|budget|reserve|context/i,
    );
  });

  it('records provider usage separately without replacing a preflight estimate', () => {
    const usage = { provider: 'fixture-provider', inputTokens: 130, outputTokens: 20 };
    const result = measureRequest(request, limits, estimateUtf8QuarterTokens, usage);
    expect(result.unit).toBe('estimate');
    expect(result.providerUsage).toEqual(usage);
    usage.inputTokens = 1;
    expect(result.providerUsage?.inputTokens).toBe(130);
    expect(result.providerOverflow).toBe(true);
  });

  it('does not accept an unversioned counter or invalid provider usage', () => {
    expect(() => measureRequest(request, limits, { ...counter(1), id: '' })).toThrow(/counter/i);
    expect(() =>
      measureRequest(request, limits, counter(1), {
        provider: 'fixture-provider',
        inputTokens: -1,
        outputTokens: 0,
      }),
    ).toThrow(/usage|tokens/i);
  });
});
