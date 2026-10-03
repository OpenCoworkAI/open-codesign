import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { complete } from './index';

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

async function startStalledOpenAIServer(): Promise<{ baseUrl: string; requests: () => number }> {
  let requests = 0;
  server = createServer(() => {
    requests += 1;
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests: () => requests };
}

describe('complete request timeout (#199)', () => {
  it('applies timeoutMs to the provider SDK HTTP request instead of its 10-minute default', async () => {
    const stalled = await startStalledOpenAIServer();
    const started = Date.now();

    await expect(
      complete(
        { provider: 'custom-lmstudio', modelId: 'local-model' },
        [{ role: 'user', content: 'Reply OK' }],
        {
          apiKey: '',
          allowKeyless: true,
          wire: 'openai-chat',
          baseUrl: stalled.baseUrl,
          timeoutMs: 200,
        },
      ),
    ).rejects.toThrow(/timed out/i);

    expect(stalled.requests()).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
