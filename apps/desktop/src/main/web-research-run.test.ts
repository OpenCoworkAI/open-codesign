import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions, request } from 'node:http';
import type { Config } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import { createWebResearchAuthorization } from './web-research';
import { createWebResearchRun } from './web-research-run';

function transport() {
  const seen: RequestOptions[] = [];
  const send = ((
    _url: URL,
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    seen.push(options);
    const req = new EventEmitter() as ClientRequest;
    req.write = (() => true) as ClientRequest['write'];
    req.end = (() => {
      queueMicrotask(() => {
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = 200;
        response.headers = { 'content-type': 'text/plain' };
        callback(response);
        response.emit(
          'data',
          Buffer.from(options.method === 'POST' ? '{"results":[]}' : 'x'.repeat(4000)),
        );
        response.emit('end');
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  }) as typeof request;
  return { seen, request: send, resolve: async () => [{ address: '8.8.8.8', family: 4 }] };
}

function config(): Pick<Config, 'webSearch' | 'secrets'> {
  return {
    webSearch: { enabled: true, maxCalls: 2, timeoutMs: 1000, maxChars: 1000 },
    secrets: { tavily: { ciphertext: 'original-key' } },
  };
}

describe('per-generation web research snapshot', () => {
  it('copies enabled, limits and encrypted key before first use; later runs use the latest config', async () => {
    const cached = config();
    const getCachedConfig = vi.fn(() => cached);
    const decrypt = vi.fn((value: string) => value);
    const fake = transport();
    const startRun = () => createWebResearchRun(getCachedConfig(), decrypt, fake);
    const active = startRun();
    expect(decrypt).not.toHaveBeenCalled();
    // Even an in-place cache edit must not alter the active run's snapshot.
    Object.assign(cached.webSearch ?? {}, {
      enabled: false,
      maxCalls: 3,
      timeoutMs: 2000,
      maxChars: 2000,
    });
    if (cached.secrets['tavily']) cached.secrets['tavily'].ciphertext = 'replacement-key';
    const disabled = startRun();
    expect(active.settings).toEqual({
      enabled: true,
      maxCalls: 2,
      timeoutMs: 1000,
      maxChars: 1000,
    });
    expect(disabled.settings).toEqual({
      enabled: false,
      maxCalls: 3,
      timeoutMs: 2000,
      maxChars: 2000,
    });
    await expect(disabled.network.search('query', 1)).rejects.toThrow(/Settings > Web Search/);
    await expect(disabled.network.fetch('https://example.com')).rejects.toThrow(/disabled/);
    expect(decrypt).not.toHaveBeenCalled();
    await active.network.search('query', 1);
    expect(fake.seen[0]?.headers).toMatchObject({ Authorization: 'Bearer original-key' });
    expect((await active.network.fetch('https://example.com')).text).toHaveLength(1000);
    await expect(active.network.search('query', 1)).rejects.toThrow(/budget/);
    if (cached.webSearch) cached.webSearch.enabled = true;
    const enabled = startRun();
    expect(enabled.settings).toEqual({
      enabled: true,
      maxCalls: 3,
      timeoutMs: 2000,
      maxChars: 2000,
    });
    await enabled.network.search('query', 1);
    expect(fake.seen[2]?.headers).toMatchObject({ Authorization: 'Bearer replacement-key' });
    expect((await enabled.network.fetch('https://example.com')).text).toHaveLength(2000);
    await enabled.network.fetch('https://example.com');
    await expect(enabled.network.fetch('https://example.com')).rejects.toThrow(/budget/);
    await expect(disabled.network.fetch('https://example.com')).rejects.toThrow(/disabled/);
    expect(getCachedConfig).toHaveBeenCalledTimes(3);
    expect(decrypt.mock.calls).toEqual([['original-key'], ['replacement-key']]);
  });
  it('uses the captured timeout for active requests and the updated timeout in new runs', async () => {
    vi.useFakeTimers();
    try {
      const cached = config();
      const deps = { resolve: () => new Promise<never>(() => {}) };
      const active = createWebResearchRun(cached, (value) => value, deps);
      if (cached.webSearch) cached.webSearch.timeoutMs = 2000;
      const next = createWebResearchRun(cached, (value) => value, deps);
      const activeRequest = expect(active.network.fetch('https://example.com')).rejects.toThrow(
        /timed out/,
      );
      let nextTimedOut = false;
      const nextRequest = expect(next.network.fetch('https://example.com'))
        .rejects.toThrow(/timed out/)
        .then(() => {
          nextTimedOut = true;
        });
      await vi.advanceTimersByTimeAsync(1000);
      await activeRequest;
      expect(nextTimedOut).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      await nextRequest;
      expect(nextTimedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps direct fetch usable when a stored Tavily credential cannot be decrypted', async () => {
    const decrypt = vi.fn(() => {
      throw new Error('secret-key-that-must-not-escape');
    });
    const fake = transport();
    const run = createWebResearchRun(config(), decrypt, fake);
    expect(decrypt).not.toHaveBeenCalled();
    await expect(run.network.fetch('https://example.com')).resolves.toMatchObject({
      contentType: 'text/plain',
    });
    expect(decrypt).not.toHaveBeenCalled();
    await expect(run.network.search('query', 1)).rejects.toThrow(
      'Tavily credentials could not be read. Replace the key in Settings > Web Search, then start a new turn; no app restart is needed. Never paste keys into chat.',
    );
    await expect(run.network.search('query', 1)).rejects.not.toThrow(
      /secret-key-that-must-not-escape/,
    );
    await expect(run.network.fetch('https://example.com')).resolves.toMatchObject({
      contentType: 'text/plain',
    });
    expect(decrypt).toHaveBeenCalledOnce();
    expect(fake.seen).toHaveLength(2);
    for (const sent of fake.seen) expect(sent.headers).not.toHaveProperty('Authorization');
  });
  it('clearing a key affects the next run without disabling fetch or changing an active key', async () => {
    const cached = config();
    const decrypt = vi.fn((value: string) => value);
    const fake = transport();
    const active = createWebResearchRun(cached, decrypt, fake);
    delete cached.secrets['tavily'];
    const cleared = createWebResearchRun(cached, decrypt, fake);
    await expect(cleared.network.search('query', 1)).rejects.toThrow(/Settings > Web Search/);
    expect(decrypt).not.toHaveBeenCalled();
    await expect(cleared.network.fetch('https://example.com')).resolves.toMatchObject({
      contentType: 'text/plain',
    });
    await active.network.search('query', 1);
    expect(fake.seen[1]?.headers).toMatchObject({ Authorization: 'Bearer original-key' });
    cached.secrets['tavily'] = { ciphertext: 'new-key' };
    await active.network.search('query', 1);
    expect(fake.seen[2]?.headers).toMatchObject({ Authorization: 'Bearer original-key' });
    expect(decrypt).toHaveBeenCalledOnce();
    await expect(cleared.network.search('query', 1)).rejects.toThrow(/not configured/);
  });
  it('keeps authorization decisions and request limits scoped to each run', async () => {
    const cached = config();
    const fake = transport();
    const active = createWebResearchRun(cached, (value) => value, fake);
    const ask = vi.fn<Parameters<typeof createWebResearchAuthorization>[1]>(async () => ({
      status: 'answered' as const,
      answers: [{ questionId: 'web-research-permission', value: 'Allow this run' }],
    }));
    const authorize = createWebResearchAuthorization(active.settings, ask);
    await authorize();
    if (cached.webSearch) cached.webSearch.maxCalls = 5;
    const next = createWebResearchRun(cached, (value) => value, fake);
    const authorizeNext = createWebResearchAuthorization(next.settings, ask);
    await authorize();
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]?.[0].questions[0]?.prompt).toContain('2 public');
    await authorizeNext();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]?.[0].questions[0]?.prompt).toContain('5 public');
    expect(fake.seen).toHaveLength(0);
  });
  it('uses safe disabled defaults without trying to decrypt absent config', async () => {
    const decrypt = vi.fn((value: string) => value);
    const run = createWebResearchRun(null, decrypt);
    expect(run.settings).toEqual({
      enabled: false,
      maxCalls: 12,
      timeoutMs: 15000,
      maxChars: 10000,
    });
    await expect(run.network.fetch('https://example.com')).rejects.toThrow(
      /new turn; no app restart/,
    );
    expect(decrypt).not.toHaveBeenCalled();
  });
});
