import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createModelSession } from './model-session.mjs';

function make(complete) {
  const journal = path.join(mkdtempSync(path.join(tmpdir(), 'codesign-model-')), 'calls.jsonl');
  return {
    journal,
    call: createModelSession({
      complete,
      config: { model: { provider: 'test', modelId: 'test' } },
      apiKey: 'secret-test-token',
      maxCalls: 1,
      journal,
    }),
  };
}
it('enforces calls and journals invalid JSON without repairing it', async () => {
  const { call, journal } = make(async () => ({
    content: '```json\n{}\n```',
    inputTokens: 1,
    outputTokens: 2,
    costUsd: 0,
  }));
  expect((await call('one', [], {})).status).toBe('invalid_json');
  await expect(call('two', [], {})).rejects.toThrow('budget');
  expect(JSON.parse(readFileSync(journal, 'utf8')).usage.outputTokens).toBe(2);
});
it('redacts a credential echo before persisting it', async () => {
  const { call, journal } = make(async () => ({
    content: '{"token":"secret-test-token"}',
    inputTokens: 1,
    outputTokens: 2,
    costUsd: 0,
  }));
  expect((await call('one', [], {})).status).toBe('credential-in-response');
  expect(readFileSync(journal, 'utf8')).not.toContain('secret-test-token');
});
it('does not record provider exception text', async () => {
  const { call, journal } = make(async () => {
    throw new Error('secret-test-token');
  });
  expect((await call('one', [], {})).status).toBe('provider_error');
  expect(readFileSync(journal, 'utf8')).not.toContain('secret-test-token');
});
