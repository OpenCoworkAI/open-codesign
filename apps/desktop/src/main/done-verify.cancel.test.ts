import { existsSync } from 'node:fs';
import { buildPreviewDocument } from '@open-codesign/runtime';
import type { LaunchOptions } from 'puppeteer-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';

const chrome = vi.hoisted(() => ({
  find: vi.fn(async () => 'synthetic-chrome'),
  launch: vi.fn<(options: LaunchOptions) => Promise<never>>(),
}));
vi.mock('@open-codesign/runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('@open-codesign/runtime')>();
  return { ...runtime, buildPreviewDocument: vi.fn(runtime.buildPreviewDocument) };
});
vi.mock('@open-codesign/exporters', () => ({ findSystemChrome: chrome.find }));
vi.mock('puppeteer-core', () => ({ default: { launch: chrome.launch } }));
vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  chrome.find.mockClear();
  chrome.launch.mockReset();
  vi.mocked(buildPreviewDocument).mockClear();
});

describe('done verifier context without a workspace', () => {
  it.each([
    { path: 'screens/index.html', runtimeMode: 'native-html' as const },
    { path: 'screens/App.tsx', runtimeMode: 'legacy-auto' as const },
    { path: 'screens/App.jsx' },
  ])('forwards the current path and mode to the runtime: %j', async (context) => {
    chrome.launch.mockRejectedValue(new Error('Synthetic launch failure'));
    const source = '<html><body>React.createElement</body></html>';
    const errors = await makeRuntimeVerifier()(source, context);
    expect(errors.some((error) => error.message.includes('Synthetic launch failure'))).toBe(true);
    expect(buildPreviewDocument).toHaveBeenCalledExactlyOnceWith(source, {
      path: context.path,
      runtimeMode: context.runtimeMode,
    });
  });
});

describe('done browser executor cancellation', () => {
  it('rejects an already aborted verification before locating or launching a browser', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Stopped'));
    await expect(
      makeRuntimeVerifier()('<html><body>Test</body></html>', {
        path: 'index.html',
        signal: controller.signal,
      }),
    ).rejects.toThrow('Stopped');
    expect(chrome.find).not.toHaveBeenCalled();
    expect(chrome.launch).not.toHaveBeenCalled();
  });

  it('passes cancellation to the owned browser launch and cleans its disposable profile', async () => {
    const controller = new AbortController();
    chrome.launch.mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('Launch cancelled')), {
            once: true,
          });
        }),
    );
    const running = makeRuntimeVerifier()('<html><body>Test</body></html>', {
      path: 'index.html',
      signal: controller.signal,
    });
    const rejected = expect(running).rejects.toThrow('Stopped');
    await vi.waitFor(() => expect(chrome.launch).toHaveBeenCalledOnce());
    const options = chrome.launch.mock.calls[0]?.[0];
    expect(options?.signal).toBe(controller.signal);
    expect(options?.userDataDir).toBeTypeOf('string');
    controller.abort(new Error('Stopped'));
    await rejected;
    expect(existsSync(options?.userDataDir ?? '')).toBe(false);
  });
});
