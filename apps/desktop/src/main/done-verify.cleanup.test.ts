import type { Browser, LaunchOptions, Page } from 'puppeteer-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';

const mocks = vi.hoisted(() => ({
  findChrome: vi.fn(async () => 'synthetic-chrome'),
  launch: vi.fn<(options: LaunchOptions) => Promise<Browser>>(),
  mkdtemp: vi.fn<(prefix: string) => Promise<string>>(async () => '/tmp/codesign-done-chrome-test'),
  rm: vi.fn<
    (
      path: string,
      options: {
        recursive: boolean;
        force: boolean;
        maxRetries: number;
        retryDelay: number;
      },
    ) => Promise<void>
  >(async () => {}),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdtemp: mocks.mkdtemp, rm: mocks.rm };
});
vi.mock('@open-codesign/exporters', () => ({ findSystemChrome: mocks.findChrome }));
vi.mock('puppeteer-core', () => ({ default: { launch: mocks.launch } }));
vi.mock('./layout-probe', () => ({
  inspectLayout: vi.fn(async () => ({})),
  layoutWarnings: vi.fn(() => []),
  layoutFailureWarning: vi.fn((err: unknown) => ({ message: String(err), source: 'layout' })),
}));

let pageError: Error | undefined;
let closeOrder: string[];

function createBrowser(): { browser: Browser; page: Page } {
  const handlers = new Map<string, (value: unknown) => void>();
  const page = {
    close: vi.fn(async () => {
      closeOrder.push('page');
    }),
    setViewport: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn((event: string, handler: (...args: never[]) => void) => {
      handlers.set(event, handler as (value: unknown) => void);
    }),
    goto: vi.fn(async () => {
      if (pageError) handlers.get('pageerror')?.(pageError);
      return null;
    }),
  } as unknown as Page;
  const browser = {
    close: vi.fn(async () => {
      closeOrder.push('browser');
    }),
    newPage: vi.fn(async () => page),
  } as unknown as Browser;
  return { browser, page };
}

beforeEach(() => {
  pageError = undefined;
  closeOrder = [];
  mocks.findChrome.mockClear();
  mocks.launch.mockReset();
  mocks.mkdtemp.mockReset().mockResolvedValue('/tmp/codesign-done-chrome-test');
  mocks.rm.mockReset().mockResolvedValue(undefined);
});

describe('done verifier temporary profile cleanup', () => {
  it('returns verification success with a warning when profile cleanup remains busy', async () => {
    const { browser } = createBrowser();
    mocks.launch.mockResolvedValue(browser);
    mocks.rm.mockImplementation(async () => {
      closeOrder.push('profile');
      throw new Error('EBUSY: profile is still busy');
    });

    const result = await makeRuntimeVerifier()('<html><body>Test</body></html>');

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      {
        message: 'Could not remove temporary browser profile: EBUSY: profile is still busy',
        source: 'cleanup',
      },
    ]);
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/codesign-done-chrome-test', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    expect(closeOrder).toEqual(['page', 'browser', 'profile']);
  });

  it('preserves real page errors when profile cleanup also fails', async () => {
    const { browser } = createBrowser();
    mocks.launch.mockResolvedValue(browser);
    pageError = new Error('ReferenceError: missingNode is not defined');
    mocks.rm.mockRejectedValue(new Error('EBUSY: profile is still busy'));

    const result = await makeRuntimeVerifier()('<html><body>Test</body></html>');

    expect(result.errors).toEqual([
      {
        message: 'ReferenceError: missingNode is not defined',
        source: 'pageerror',
      },
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ source: 'cleanup', message: expect.stringContaining('EBUSY') }),
    ]);
  });

  it('preserves cancellation when profile cleanup fails', async () => {
    const controller = new AbortController();
    mocks.launch.mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('Launch cancelled')), {
            once: true,
          });
        }),
    );
    mocks.rm.mockRejectedValue(new Error('EBUSY: profile is still busy'));

    const running = makeRuntimeVerifier()('<html><body>Test</body></html>', {
      path: 'index.html',
      signal: controller.signal,
    });
    const rejected = expect(running).rejects.toThrow('Stopped');
    await vi.waitFor(() => expect(mocks.launch).toHaveBeenCalledOnce());
    controller.abort(new Error('Stopped'));

    await rejected;
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/codesign-done-chrome-test', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });
});
