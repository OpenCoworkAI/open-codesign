import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';
import {
  assertNonEmptyParsedString,
  callDeepSeekJson,
  callDeepSeekJsonWithRetries,
  DeepSeekOutputError,
  ensureBotSignature,
  mapReasoningEffort,
  printUsage,
  resolveThinkingConfig,
} from './deepseek-common.mjs';

const MARKER = 'SYNTHETIC_PRIVATE_RESPONSE_MARKER';
const OPTIONS = Object.freeze({
  apiKey: 'synthetic-api-key-not-a-secret',
  baseUrl: 'https://deepseek-test.invalid/v1',
  model: 'deepseek-v4-flash',
  effort: 'high',
  systemPrompt: 'SYNTHETIC_PRIVATE_SYSTEM_PROMPT',
  userPrompt: 'SYNTHETIC_PRIVATE_USER_PROMPT\nKeep this complete original context.',
});
const USAGE = Object.freeze({ prompt_tokens: 101, completion_tokens: 202, total_tokens: 303 });
const VALID_CONTENT = JSON.stringify({ body: 'A complete review or issue response.' });

function payload(overrides = {}) {
  const {
    content = VALID_CONTENT,
    reasoning = '',
    finishReason = 'stop',
    model = OPTIONS.model,
    usage = USAGE,
  } = overrides;
  return {
    model,
    choices: [{ message: { reasoning_content: reasoning, content }, finish_reason: finishReason }],
    usage,
  };
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

function assertSafe(...values) {
  const rendered = inspect(values, { depth: null, maxStringLength: Infinity });
  for (const privateValue of [
    MARKER,
    OPTIONS.apiKey,
    OPTIONS.systemPrompt,
    OPTIONS.userPrompt.split('\n')[0],
  ]) {
    assert.equal(
      rendered.includes(privateValue),
      false,
      'Private data must not enter logs or errors',
    );
  }
}

function assertOutputError(error, code) {
  assert.ok(error instanceof DeepSeekOutputError);
  assert.equal(error.code, code);
  assert.equal(typeof error.diagnostics, 'object');
  assert.notEqual(error.diagnostics, null);
  assertSafe(error);
  return true;
}

function testWithMocks(name, run) {
  test(name, { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    const originals = { warn: console.warn, log: console.log, error: console.error };
    const calls = [];
    const warnings = [];
    const logs = [];
    const errors = [];
    let queued = [];
    // Never fall back to real fetch, including when a retry exhausts its fixtures.
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      assert.ok(queued.length > 0, 'Unexpected request: no mocked response remains');
      const next = queued.shift();
      return typeof next === 'function' ? next(url, init) : next;
    };
    console.warn = (...args) => warnings.push(args);
    console.log = (...args) => logs.push(args);
    console.error = (...args) => errors.push(args);
    try {
      await run({
        calls,
        warnings,
        logs,
        errors,
        queue: (...values) => {
          queued = values;
        },
      });
      assertSafe(warnings, logs, errors);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originals.warn;
      console.log = originals.log;
      console.error = originals.error;
    }
  });
}

function assertRequestPreserved(calls, effort = 'high') {
  for (const [index, { body }] of calls.entries()) {
    assert.equal(body.model, OPTIONS.model);
    assert.equal(body.reasoning_effort, mapReasoningEffort(effort));
    assert.deepEqual(body.thinking, resolveThinkingConfig(OPTIONS.model, effort));
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages[0], { role: 'system', content: OPTIONS.systemPrompt });
    assert.equal(body.messages[1].role, 'user');
    if (index === 0) {
      assert.equal(body.messages[1].content, OPTIONS.userPrompt);
    } else {
      assert.ok(body.messages[1].content.startsWith(OPTIONS.userPrompt));
      assert.ok(body.messages[1].content.length > OPTIONS.userPrompt.length);
      assert.match(body.messages[1].content.slice(OPTIONS.userPrompt.length), /JSON/i);
    }
    assert.equal(
      JSON.stringify(body).includes(MARKER),
      false,
      'Never feed raw output into retries',
    );
  }
}

describe('DeepSeek automation output contract', { concurrency: false }, () => {
  testWithMocks('maps supported effort aliases without silently promoting xhigh to max', () => {
    const aliases = {
      none: 'none',
      low: 'low',
      minimal: 'low',
      medium: 'high',
      high: 'high',
      xhigh: 'high',
      max: 'max',
      ultra: 'max',
    };
    for (const [input, expected] of Object.entries(aliases)) {
      assert.equal(mapReasoningEffort(input), expected, input);
      for (const model of [
        'deepseek-v4-flash',
        'deepseek-v4-pro',
        'deepseek-chat',
        'deepseek-reasoner',
      ]) {
        assert.deepEqual(
          resolveThinkingConfig(model, input),
          {
            type: expected === 'none' ? 'disabled' : 'enabled',
          },
          `${model}/${input}`,
        );
      }
    }
    assert.equal(mapReasoningEffort(), 'high');
    assert.deepEqual(resolveThinkingConfig('deepseek-v4-flash'), { type: 'enabled' });
    assert.deepEqual(resolveThinkingConfig('deepseek-chat'), { type: 'enabled' });
    assert.throws(() => mapReasoningEffort('unsupported-effort'));
    assert.throws(() => resolveThinkingConfig('deepseek-v4-flash', 'unsupported-effort'));
  });

  for (const [label, callerOptions, expectedTokens] of [
    ['issue default', {}, 8192],
    ['PR budget', { maxTokens: 16384, maxRetryTokens: 32768 }, 16384],
  ]) {
    testWithMocks(`stop plus a valid body succeeds with ${label}`, async ({ queue, calls }) => {
      queue(response(payload()));
      const result = await callDeepSeekJsonWithRetries({ ...OPTIONS, ...callerOptions });
      assert.deepEqual(result.parsed, JSON.parse(VALID_CONTENT));
      assert.equal(result.content, VALID_CONTENT);
      assert.deepEqual(result.usage, USAGE);
      const body = ensureBotSignature(assertNonEmptyParsedString(result.parsed));
      assert.match(body, /A complete review or issue response/);
      assert.match(body, /\*Open-CoDesign Bot\*/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.max_tokens, expectedTokens);
      assertRequestPreserved(calls);
    });
  }

  testWithMocks(
    'single request defaults to 8192 and returns safe structured diagnostics',
    async ({ queue, calls }) => {
      const reasoning = `${'r'.repeat(1200)}${MARKER}`;
      queue(response(payload({ reasoning, model: 'deepseek-v4-flash-returned' })));
      const result = await callDeepSeekJson(OPTIONS);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://deepseek-test.invalid/chat/completions');
      assert.equal(calls[0].init.method, 'POST');
      assert.equal(calls[0].body.max_tokens, 8192);
      assert.deepEqual(result.diagnostics, {
        requestedModel: OPTIONS.model,
        returnedModel: 'deepseek-v4-flash-returned',
        finishReason: 'stop',
        maxTokens: 8192,
        contentChars: VALID_CONTENT.length,
        reasoningChars: reasoning.length,
        usage: USAGE,
      });
      assertSafe(result.diagnostics, result.usage);
    },
  );

  for (const [finishReason, code] of [
    ['length', 'OUTPUT_TRUNCATED'],
    ['content_filter', 'INCOMPLETE_OUTPUT'],
    ['aborted', 'INCOMPLETE_OUTPUT'],
    ['insufficient_system_resource', 'INCOMPLETE_OUTPUT'],
    [null, 'INCOMPLETE_OUTPUT'],
    ['', 'INCOMPLETE_OUTPUT'],
    ['STOP', 'INCOMPLETE_OUTPUT'],
    ['missing', 'INCOMPLETE_OUTPUT'],
  ]) {
    testWithMocks(
      `valid JSON is rejected when finish_reason is ${String(finishReason)}`,
      async ({ queue, calls }) => {
        const value = payload({ finishReason });
        if (finishReason === 'missing') delete value.choices[0].finish_reason;
        queue(response(value));
        await assert.rejects(callDeepSeekJson(OPTIONS), (error) => assertOutputError(error, code));
        assert.equal(calls.length, 1);
      },
    );
    if (code === 'INCOMPLETE_OUTPUT') {
      testWithMocks(
        `finish_reason ${String(finishReason)} is not retried`,
        async ({ queue, calls }) => {
          const value = payload({ finishReason });
          if (finishReason === 'missing') delete value.choices[0].finish_reason;
          queue(response(value), response(payload()));
          await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) =>
            assertOutputError(error, code),
          );
          assert.equal(calls.length, 1);
        },
      );
    }
  }

  for (const [label, content] of [
    ['empty', ''],
    ['whitespace', ' \n\t'],
    ['null', null],
    ['missing', undefined],
  ]) {
    testWithMocks(
      `stop with ${label} content fails without using reasoning as its body`,
      async ({ queue }) => {
        const value = payload({ content, reasoning: JSON.stringify({ body: MARKER }) });
        if (content === undefined) delete value.choices[0].message.content;
        queue(response(value));
        await assert.rejects(callDeepSeekJson(OPTIONS), (error) =>
          assertOutputError(error, 'EMPTY_CONTENT'),
        );
      },
    );
  }

  for (const content of [
    'not JSON',
    'null',
    '[]',
    '[{"body":"not an object root"}]',
    '42',
    '"text"',
  ]) {
    testWithMocks(
      `stop rejects non-object JSON or invalid content: ${content}`,
      async ({ queue }) => {
        queue(response(payload({ content })));
        await assert.rejects(callDeepSeekJson(OPTIONS), (error) =>
          assertOutputError(error, 'INVALID_JSON'),
        );
      },
    );
  }

  testWithMocks('malformed outer JSON is safe and not retried', async ({ queue, calls }) => {
    queue(response(`{"private":"${MARKER}"`), response(payload()));
    await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) =>
      assertOutputError(error, 'INVALID_RESPONSE'),
    );
    assert.equal(calls.length, 1);
  });

  testWithMocks(
    'body validation rejects null, missing, whitespace, arrays and non-strings without serialization',
    () => {
      for (const parsed of [
        null,
        {},
        { body: null },
        { body: '' },
        { body: ' \n\t' },
        { body: [] },
        { body: [MARKER] },
        { body: 123 },
        { body: {} },
        [],
      ]) {
        assert.throws(
          () => assertNonEmptyParsedString(parsed),
          (error) => assertOutputError(error, 'EMPTY_BODY'),
        );
      }
      let serialized = false;
      const parsed = {
        private: MARKER,
        toJSON() {
          serialized = true;
          throw new Error(MARKER);
        },
        toString() {
          serialized = true;
          throw new Error(MARKER);
        },
      };
      assert.throws(
        () => assertNonEmptyParsedString(parsed),
        (error) => assertOutputError(error, 'EMPTY_BODY'),
      );
      assert.equal(serialized, false);
      assert.equal(assertNonEmptyParsedString({ body: ' \n Ready to post. \t' }), 'Ready to post.');
      assert.equal(
        assertNonEmptyParsedString({ summary: ' Custom field ' }, 'summary'),
        'Custom field',
      );
    },
  );

  testWithMocks(
    'truncation grows 8192 to 16384 to 32768 with a default cap of three attempts',
    async ({ queue, calls, warnings }) => {
      const truncated = () => response(payload({ finishReason: 'length', reasoning: MARKER }));
      queue(truncated(), truncated(), truncated(), response(payload()));
      await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) =>
        assertOutputError(error, 'OUTPUT_TRUNCATED'),
      );
      assert.deepEqual(
        calls.map(({ body }) => body.max_tokens),
        [8192, 16384, 32768],
      );
      assert.equal(warnings.length, 2);
      assertRequestPreserved(calls);
    },
  );

  testWithMocks(
    'PR truncation stops after 16384 and 32768 when it cannot grow',
    async ({ queue, calls }) => {
      const truncated = () => response(payload({ finishReason: 'length' }));
      queue(truncated(), truncated(), response(payload()));
      await assert.rejects(
        callDeepSeekJsonWithRetries({
          ...OPTIONS,
          maxTokens: 16384,
          maxRetryTokens: 32768,
        }),
        (error) => assertOutputError(error, 'OUTPUT_TRUNCATED'),
      );
      assert.deepEqual(
        calls.map(({ body }) => body.max_tokens),
        [16384, 32768],
      );
    },
  );

  testWithMocks(
    'reasoning-only stop consumes a larger budget, never a reasoning body',
    async ({ queue, calls }) => {
      queue(
        response(payload({ content: '', reasoning: JSON.stringify({ body: MARKER }) })),
        response(payload()),
      );
      const result = await callDeepSeekJsonWithRetries(OPTIONS);
      assert.deepEqual(
        calls.map(({ body }) => body.max_tokens),
        [8192, 16384],
      );
      assert.equal(result.parsed.body, JSON.parse(VALID_CONTENT).body);
      assertRequestPreserved(calls);
    },
  );

  for (const [label, invalid] of [
    ['invalid JSON', { content: MARKER }],
    ['empty body', { content: JSON.stringify({ body: '', private: MARKER }) }],
    ['empty content without reasoning', { content: '' }],
  ]) {
    testWithMocks(
      `${label} retries at the same budget with the original context and a reminder`,
      async ({ queue, calls }) => {
        queue(response(payload(invalid)), response(payload(invalid)), response(payload()));
        const result = await callDeepSeekJsonWithRetries(OPTIONS);
        assert.equal(result.content, VALID_CONTENT);
        assert.deepEqual(
          calls.map(({ body }) => body.max_tokens),
          [8192, 8192, 8192],
        );
        assertRequestPreserved(calls);
      },
    );
  }

  for (const effort of ['none', 'low', 'minimal', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    testWithMocks(
      `retries preserve model, effort and explicit thinking for ${effort}`,
      async ({ queue, calls }) => {
        queue(response(payload({ finishReason: 'length' })), response(payload()));
        await callDeepSeekJsonWithRetries({ ...OPTIONS, effort });
        assertRequestPreserved(calls, effort);
      },
    );
  }

  testWithMocks(
    'custom retry ceiling clamps growth and allows a successful final response',
    async ({ queue, calls }) => {
      queue(response(payload({ finishReason: 'length' })), response(payload()));
      await callDeepSeekJsonWithRetries({ ...OPTIONS, maxTokens: 20000, maxRetryTokens: 30000 });
      assert.deepEqual(
        calls.map(({ body }) => body.max_tokens),
        [20000, 30000],
      );
    },
  );

  testWithMocks(
    'default retry ceiling never falls below the initial budget',
    async ({ queue, calls }) => {
      queue(response(payload({ finishReason: 'length' })), response(payload()));
      await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxTokens: 40000 }), (error) =>
        assertOutputError(error, 'OUTPUT_TRUNCATED'),
      );
      assert.deepEqual(
        calls.map(({ body }) => body.max_tokens),
        [40000],
      );
    },
  );

  testWithMocks(
    'reasoning-only content stops immediately when its budget cannot grow',
    async ({ queue, calls }) => {
      queue(response(payload({ content: '', reasoning: MARKER })), response(payload()));
      await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxTokens: 65536 }), (error) =>
        assertOutputError(error, 'EMPTY_CONTENT'),
      );
      assert.equal(calls.length, 1);
    },
  );

  testWithMocks(
    'one requested attempt does not retry an otherwise retryable failure',
    async ({ queue, calls, warnings }) => {
      queue(response(payload({ finishReason: 'length' })), response(payload()));
      await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxAttempts: 1 }), (error) =>
        assertOutputError(error, 'OUTPUT_TRUNCATED'),
      );
      assert.equal(calls.length, 1);
      assert.equal(warnings.length, 0);
    },
  );

  testWithMocks(
    'tail finish reason and usage survive a long private reasoning prefix',
    async ({ queue, warnings, calls }) => {
      const reasoning = `${MARKER}${'private reasoning '.repeat(100)}`;
      const usage = {
        ...USAGE,
        private: MARKER,
        completion_tokens_details: { reasoning_tokens: 199, private: MARKER },
      };
      queue(response(payload({ content: '', reasoning, finishReason: 'length', usage })));
      await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxAttempts: 1 }), (error) => {
        assertOutputError(error, 'OUTPUT_TRUNCATED');
        assert.equal(error.diagnostics.finishReason, 'length');
        assert.equal(error.diagnostics.reasoningChars, reasoning.length);
        assert.equal(error.diagnostics.contentChars, 0);
        assert.equal(error.diagnostics.usage.completion_tokens, 202);
        assert.equal(error.diagnostics.usage.completion_tokens_details.reasoning_tokens, 199);
        assertSafe(error, warnings);
        return true;
      });
      assert.equal(calls.length, 1);
    },
  );

  testWithMocks(
    'invalid JSON and body errors do not echo raw completions or prompts',
    async ({ queue }) => {
      queue(
        response(payload({ content: `broken ${MARKER} ${OPTIONS.apiKey} ${OPTIONS.userPrompt}` })),
      );
      await assert.rejects(callDeepSeekJson(OPTIONS), (error) =>
        assertOutputError(error, 'INVALID_JSON'),
      );
      assert.throws(
        () => assertNonEmptyParsedString({ body: null, private: MARKER }),
        (error) => assertOutputError(error, 'EMPTY_BODY'),
      );
    },
  );

  for (const raw of [
    `<html>${MARKER}</html>`,
    JSON.stringify({ error: MARKER }),
    `{broken ${MARKER}`,
  ]) {
    testWithMocks(
      `HTTP failures exclude raw bodies (${raw.startsWith('<') ? 'HTML' : raw.startsWith('{broken') ? 'malformed JSON' : 'JSON'})`,
      async ({ queue, calls }) => {
        queue(response(raw, 429), response(payload()));
        await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) => {
          assertOutputError(error, 'HTTP_ERROR');
          assert.equal(error.diagnostics.status ?? error.status, 429);
          return true;
        });
        assert.equal(calls.length, 1);
      },
    );
  }

  for (const phase of ['network', 'response text']) {
    testWithMocks(
      `${phase} timeouts become safe REQUEST_FAILED errors without retry`,
      async ({ queue, calls }) => {
        const fail = async () => {
          const error = new Error(`${MARKER} ${OPTIONS.apiKey} ${OPTIONS.userPrompt}`);
          error.name = 'TimeoutError';
          throw error;
        };
        queue(
          phase === 'network' ? fail : { ok: true, status: 200, text: fail },
          response(payload()),
        );
        await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) =>
          assertOutputError(error, 'REQUEST_FAILED'),
        );
        assert.equal(calls.length, 1);
      },
    );
  }

  testWithMocks(
    'returned usage and printUsage allow only numeric whitelisted usage metadata',
    async ({ queue, logs }) => {
      const usage = {
        ...USAGE,
        prompt_cache_hit_tokens: 11,
        prompt_cache_miss_tokens: 90,
        completion_tokens_details: { reasoning_tokens: 180, private: MARKER, unlisted_count: 99 },
        prompt_tokens_details: { cached_tokens: 11, private: MARKER },
        private: MARKER,
        unlisted_count: 999,
      };
      queue(response(payload({ usage })));
      const result = await callDeepSeekJson(OPTIONS);
      for (const safe of [result.usage, result.diagnostics.usage]) {
        assert.equal(safe.prompt_tokens, 101);
        assert.equal(safe.completion_tokens, 202);
        assert.equal(safe.total_tokens, 303);
        assert.equal(safe.completion_tokens_details.reasoning_tokens, 180);
        assert.equal('private' in safe, false);
        assert.equal('unlisted_count' in safe, false);
        assert.equal('unlisted_count' in safe.completion_tokens_details, false);
        assertSafe(safe);
      }
      printUsage('DeepSeek test', usage);
      assert.ok(logs.length > 0);
      assertSafe(logs);
      assert.equal(inspect(logs).includes('unlisted_count'), false);
      logs.length = 0;
      printUsage('DeepSeek test', {
        prompt_tokens: MARKER,
        completion_tokens: Number.POSITIVE_INFINITY,
        total_tokens: { private: MARKER },
        prompt_cache_hit_tokens: -1,
        completion_tokens_details: { reasoning_tokens: MARKER },
        private: MARKER,
      });
      assertSafe(logs);
      assert.equal(inspect(logs).includes('Infinity'), false);
      assert.equal(inspect(logs).includes('-1'), false);
    },
  );

  testWithMocks(
    'invalid token budgets and attempt bounds reject before any request',
    async ({ calls }) => {
      const invalidBounds = [0, -1, 65537, 1.5, NaN, Infinity, '8192', null];
      for (const maxTokens of invalidBounds) {
        await assert.rejects(callDeepSeekJson({ ...OPTIONS, maxTokens }));
        await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxTokens }));
      }
      for (const maxRetryTokens of [...invalidBounds, 4096]) {
        await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxRetryTokens }));
      }
      for (const maxAttempts of [0, -1, 4, 1.5, NaN, Infinity, '3', null]) {
        await assert.rejects(callDeepSeekJsonWithRetries({ ...OPTIONS, maxAttempts }));
      }
      await assert.rejects(
        callDeepSeekJsonWithRetries({ ...OPTIONS, effort: 'unsupported-effort' }),
      );
      assert.equal(calls.length, 0);
    },
  );

  testWithMocks('inclusive token bounds accept 1 and 65536', async ({ queue, calls }) => {
    queue(response(payload()), response(payload()));
    for (const maxTokens of [1, 65536]) {
      await callDeepSeekJsonWithRetries({ ...OPTIONS, maxTokens, maxRetryTokens: maxTokens });
    }
    assert.deepEqual(
      calls.map(({ body }) => body.max_tokens),
      [1, 65536],
    );
  });
  testWithMocks(
    'native HTTP error responses are cancelled without exposing their bodies',
    async ({ queue, calls }) => {
      for (const status of [401, 402]) {
        const failed = new Response(`${MARKER} ${OPTIONS.apiKey}`, { status });
        queue(failed);
        await assert.rejects(callDeepSeekJsonWithRetries(OPTIONS), (error) => {
          assertOutputError(error, 'HTTP_ERROR');
          assert.equal(error.diagnostics.status, status);
          return true;
        });
        assert.equal(failed.bodyUsed, true);
      }
      assert.equal(calls.length, 2);
    },
  );

  testWithMocks(
    'model diagnostics omit credentials and malformed returned identifiers',
    async ({ queue }) => {
      for (const model of [OPTIONS.apiKey, `bad\n${MARKER}`, 'x'.repeat(129)]) {
        queue(response(payload({ model })));
        const result = await callDeepSeekJson(OPTIONS);
        assert.equal(result.diagnostics.returnedModel, null);
        assertSafe(result.diagnostics);
      }
      queue(response(payload()));
      const result = await callDeepSeekJson({ ...OPTIONS, model: OPTIONS.apiKey });
      assert.equal(result.diagnostics.requestedModel, null);
      assertSafe(result.diagnostics);
    },
  );
});
