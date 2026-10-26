import { describe, expect, it } from 'vitest';
import { parseUnifiedConfig } from './unified-config.js';
import { createUnifiedSession } from './unified-session.js';

const target = {
  model: { provider: 'fixture', modelId: 'fixture-v1' },
  credentialEnv: 'FIXTURE_API_KEY',
  contextWindowTokens: 32768,
};
const config = () =>
  parseUnifiedConfig({
    models: { compressor: target, reader: target },
    maxCalls: 2,
    timeoutMs: 30,
    allowEstimatedBudget: true,
  });
const request = {
  id: 'case/read',
  role: 'reader' as const,
  messages: [{ role: 'user' as const, content: 'hello' }],
};
const reply = { content: '{"answer":"ok"}', inputTokens: 12, outputTokens: 4, costUsd: 0 };

describe('unified config', () => {
  it('defaults to unconfigured dry-run targets and frozen budget tiers', () => {
    const result = parseUnifiedConfig({});
    expect(result.maxCalls).toBe(0);
    expect(result.budgets).toEqual([2048, 4096, 8192]);
    expect(result.trials).toBe(3);
  });
  it.each([
    { apiKey: 'SECRET' },
    { models: { compressor: { ...target, apiKey: 'SECRET' }, reader: target } },
    { maxCalls: -1 },
    { timeoutMs: 0 },
    { budgets: [2048, 2048] },
    { caseIds: ['a', 'a'] },
    {
      models: {
        compressor: { ...target, baseUrl: 'https://user:secret@example.com' },
        reader: target,
      },
    },
    {
      models: {
        compressor: { ...target, baseUrl: 'https://example.com/?key=secret' },
        reader: target,
      },
    },
  ])('rejects unsafe or ambiguous config %j', (value) =>
    expect(() => parseUnifiedConfig(value)).toThrow());
});

describe('bounded pi model session', () => {
  it('uses configured limits, retains request identity and records reported usage', async () => {
    const session = createUnifiedSession(config(), {
      getCredential: () => 'private-key',
      complete: async (model, messages, options) => {
        expect(model).toEqual(target.model);
        expect(messages).toEqual(request.messages);
        expect(options.maxTokens).toBe(1024);
        expect(options.timeoutMs).toBe(30);
        expect(options.maxRetries).toBe(0);
        return reply;
      },
    });
    const result = await session.call(request);
    expect(result.status).toBe('ok');
    expect(result.value).toEqual({ answer: 'ok' });
    expect(result.usage).toMatchObject({
      reportedInputTokens: 12,
      reportedOutputTokens: 4,
      reportedCostUsd: 0,
      totalInputTokens: null,
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(session.stats().providerCalls).toBe(1);
  });

  it('enforces cap before reading credentials and rejects duplicate calls', async () => {
    let reads = 0,
      calls = 0;
    const session = createUnifiedSession(
      { ...config(), maxCalls: 1 },
      {
        getCredential: () => {
          reads++;
          return 'key';
        },
        complete: async () => {
          calls++;
          return reply;
        },
      },
    );
    expect((await session.call(request)).status).toBe('ok');
    expect((await session.call({ ...request, id: 'another' })).status).toBe('call-limit');
    expect(reads).toBe(1);
    expect(calls).toBe(1);
    const duplicate = createUnifiedSession(config(), {
      getCredential: () => 'key',
      complete: async () => reply,
    });
    await duplicate.call(request);
    expect((await duplicate.call(request)).status).toBe('duplicate-call');
  });

  it('does not read a key or call a provider when cancelled before start', async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createUnifiedSession(
      config(),
      {
        getCredential: () => {
          throw new Error('key read');
        },
        complete: async () => {
          throw new Error('called');
        },
      },
      controller.signal,
    );
    expect((await session.call(request)).status).toBe('cancelled');
    expect(session.stats().providerCalls).toBe(0);
  });

  it('times out an unresponsive provider, aborts it and stops further calls', async () => {
    let observed: AbortSignal | undefined;
    const session = createUnifiedSession(config(), {
      getCredential: () => 'key',
      complete: async (_m, _s, opts) => {
        observed = opts.signal;
        return new Promise(() => {});
      },
    });
    expect((await session.call(request)).status).toBe('timeout');
    expect(observed?.aborted).toBe(true);
    expect((await session.call({ ...request, id: 'later' })).status).toBe('stopped');
  });

  it('supports external cancellation during a request', async () => {
    const controller = new AbortController();
    const session = createUnifiedSession(
      config(),
      {
        getCredential: () => 'key',
        complete: async () => {
          controller.abort();
          return new Promise(() => {});
        },
      },
      controller.signal,
    );
    expect((await session.call(request)).status).toBe('cancelled');
  });

  it('keeps malformed JSON as a failure without repairing the text', async () => {
    const session = createUnifiedSession(config(), {
      getCredential: () => 'key',
      complete: async () => ({ ...reply, content: '~~~json\n{"x":1}\n~~~' }),
    });
    const result = await session.call(request);
    expect(result.status).toBe('invalid-json');
    expect(result.value).toBeNull();
  });

  it('keeps length-stop usage and never treats a partial answer as success', async () => {
    const session = createUnifiedSession(config(), {
      getCredential: () => 'key',
      complete: async () => {
        throw Object.assign(new Error('partial key'), {
          name: 'CompletionLengthError',
          usage: { inputTokens: 8, outputTokens: 30, costUsd: 0 },
        });
      },
    });
    const result = await session.call(request);
    expect(result.status).toBe('length');
    expect(result.value).toBeNull();
    expect(result.usage?.reportedOutputTokens).toBe(30);
  });

  it('never serializes provider errors or echoed credentials', async () => {
    for (const encoded of ['private-key', encodeURIComponent('private-key')]) {
      const session = createUnifiedSession(config(), {
        getCredential: () => 'private-key',
        complete: async () => ({ ...reply, content: `{"key":"${encoded}"}` }),
      });
      const result = await session.call(request);
      expect(result.status).toBe('credential-in-response');
      expect(JSON.stringify(result)).not.toContain('private-key');
    }
    const session = createUnifiedSession(config(), {
      getCredential: () => 'private-key',
      complete: async () => {
        throw new Error('Authorization private-key');
      },
    });
    const result = await session.call(request);
    expect(result.status).toBe('provider-error');
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('allows no overlapping calls and does not fetch credentials for a busy session', async () => {
    let finish: ((v: typeof reply) => void) | undefined,
      reads = 0;
    const session = createUnifiedSession(config(), {
      getCredential: () => {
        reads++;
        return 'key';
      },
      complete: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const first = session.call(request);
    expect((await session.call({ ...request, id: 'other' })).status).toBe('busy');
    expect(reads).toBe(1);
    finish?.(reply);
    expect((await first).status).toBe('ok');
  });
});

it('emits request intent before provider work and a response for durable journaling', async () => {
  const events: string[] = [];
  const session = createUnifiedSession(config(), {
    getCredential: () => 'unique-credential',
    onRequest: (row) => {
      events.push(`request:${row.id}`);
      expect(JSON.stringify(row)).not.toContain('unique-credential');
    },
    complete: async () => {
      events.push('provider');
      return reply;
    },
  });
  await session.call(request);
  expect(events).toEqual(['request:case/read', 'provider']);
});

it('does not reuse an empty keyless credential for an authenticated reader sharing an env name', async () => {
  let reads = 0;
  const settings = config();
  settings.models.compressor.allowKeyless = true;
  const session = createUnifiedSession(settings, {
    getCredential: () => {
      reads++;
      return 'authenticated-fixture-credential';
    },
    complete: async (_model, _messages, options) => {
      if (options.allowKeyless) expect(options.apiKey).toBe('');
      else expect(options.apiKey).toBe('authenticated-fixture-credential');
      return reply;
    },
  });
  expect((await session.call({ ...request, id: 'first', role: 'compressor' })).status).toBe('ok');
  expect((await session.call({ ...request, id: 'second' })).status).toBe('ok');
  expect(reads).toBe(1);
});
it('honors cancellation from a request observer before calling the provider', async () => {
  const controller = new AbortController();
  let calls = 0;
  const session = createUnifiedSession(
    config(),
    {
      getCredential: () => 'unique-credential',
      onRequest: () => controller.abort(),
      complete: async () => {
        calls++;
        return reply;
      },
    },
    controller.signal,
  );
  expect((await session.call(request)).status).toBe('cancelled');
  expect(calls).toBe(0);
});

it.each([
  '{"value":"credential-fixture"}',
  '{"value":"\\u0063redential-fixture"}',
])('normalizes credentials and rejects decoded echoes %s', async (content) => {
  let transmitted = '';
  const session = createUnifiedSession(config(), {
    getCredential: () =>
      content.includes('\\u0063') ? 'credential-fixture' : ' credential-fixture ',
    complete: async (_m, _s, options) => {
      transmitted = options.apiKey;
      return { ...reply, content };
    },
  });
  const result = await session.call(request);
  expect(transmitted).toBe('credential-fixture');
  expect(result.status).toBe('credential-in-response');
  expect(result.value).toBeNull();
  expect(result.raw).toBe('[REDACTED]');
  expect(session.stats().stopped).toBe(true);
});
