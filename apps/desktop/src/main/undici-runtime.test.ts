import { readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { getGlobalDispatcher } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import { withTlsBypass } from './tls-override';

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

describe('bundled pi HTTP runtime', () => {
  it('uses the same installed Undici version as the application external', () => {
    const appRequire = createRequire(import.meta.url);
    const piRequire = createRequire(
      realpathSync(
        new URL('../../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url),
      ),
    );
    const version = (from: ReturnType<typeof createRequire>): string => {
      const metadata = JSON.parse(readFileSync(from.resolve('undici/package.json'), 'utf8')) as {
        version: string;
      };
      return metadata.version;
    };

    // electron-vite resolves bundled pi's external production dependencies
    // from the app. Checking the nested install alone misses a runtime mismatch.
    expect(version(appRequire)).toBe(version(piRequire));
  });

  it('bridges the app dispatcher to native fetch and restores it after a request', async () => {
    const server = createServer((_request, response) => response.end('runtime-ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const original = getGlobalDispatcher();
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing test port');
      const text = await withTlsBypass(true, async () => {
        expect(getGlobalDispatcher()).not.toBe(original);
        const response = await fetch(`http://127.0.0.1:${address.port}/`);
        return response.text();
      });
      expect(text).toBe('runtime-ok');
      expect(getGlobalDispatcher()).toBe(original);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
