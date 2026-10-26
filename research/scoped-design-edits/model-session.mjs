import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Inject the repository's existing pi-backed complete function. Never creates a second provider SDK.
export function createModelSession({ complete, config, apiKey, maxCalls, journal }) {
  let calls = 0;
  let stopped = false;
  return async (id, messages, schema) => {
    if (stopped || calls >= maxCalls)
      throw new Error('Research call budget exhausted or provider stopped');
    calls++;
    const start = performance.now();
    const controller = new AbortController();
    let timer;
    const row = {
      id,
      requestHash: hash(messages),
      messages,
      status: 'provider_error',
      value: null,
      raw: null,
      usage: null,
      elapsedMs: 0,
    };
    console.log(JSON.stringify({ stage: 'request', id, call: calls, maxCalls }));
    try {
      const result = await Promise.race([
        complete(config.model, messages, {
          apiKey,
          baseUrl: config.baseUrl,
          wire: config.wire,
          reasoning: config.reasoning,
          signal: controller.signal,
          timeoutMs: 240000,
          maxTokens: 8192,
          ...(config.wire === 'openai-chat'
            ? { jsonSchema: { name: 'research_response', schema } }
            : {}),
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('research-timeout'));
          }, 240000);
        }),
      ]);
      row.usage = {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      };
      const secrets = [apiKey, encodeURIComponent(apiKey), JSON.stringify(apiKey).slice(1, -1)];
      if (secrets.some((secret) => secret && result.content.includes(secret))) {
        row.raw = '[REDACTED]';
        row.status = 'credential-in-response';
        stopped = true;
      } else {
        row.raw = result.content;
        try {
          row.value = JSON.parse(result.content);
          row.status = 'ok';
        } catch {
          row.status = 'invalid_json';
        }
      }
    } catch (error) {
      row.status =
        error?.name === 'CompletionLengthError'
          ? 'truncated'
          : controller.signal.aborted
            ? 'timeout'
            : 'provider_error';
      if (error?.name === 'CompletionLengthError') row.usage = error.usage ?? null;
      if (['timeout', 'provider_error'].includes(row.status)) stopped = true;
      // Never persist provider error strings, headers or credentials.
    } finally {
      clearTimeout(timer);
    }
    row.elapsedMs = Math.round(performance.now() - start);
    appendFileSync(journal, `${JSON.stringify(row)}\n`);
    console.log(
      JSON.stringify({ stage: 'response', id, status: row.status, elapsedMs: row.elapsedMs }),
    );
    return row;
  };
}
