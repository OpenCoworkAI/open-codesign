import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';
import { isHarnessDocumentRequest, runPreview } from './preview-runtime';

interface FakeRequest {
  url: () => string;
  isNavigationRequest: () => boolean;
  resourceType: () => string;
  respond: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

const browser = vi.hoisted(() => ({
  navigations: [] as Array<{ url: string; existedOnDisk: boolean; request: FakeRequest }>,
}));

vi.mock('@open-codesign/exporters', () => ({ findSystemChrome: async () => 'synthetic-chrome' }));
vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock('puppeteer-core', () => ({
  default: {
    launch: async () => {
      const handlers = new Map<string, (arg: unknown) => void>();
      const page = {
        setViewport: async () => {},
        setRequestInterception: async () => {},
        evaluateOnNewDocument: async () => {},
        on: (event: string, handler: (arg: unknown) => void) => handlers.set(event, handler),
        goto: async (url: string) => {
          const request: FakeRequest = {
            url: () => url,
            isNavigationRequest: () => true,
            resourceType: () => 'document',
            respond: vi.fn(async () => {}),
            continue: vi.fn(async () => {}),
            abort: vi.fn(async () => {}),
          };
          browser.navigations.push({
            url,
            existedOnDisk: existsSync(fileURLToPath(url)),
            request,
          });
          handlers.get('request')?.(request);
          await vi.waitFor(() => expect(request.respond).toHaveBeenCalled());
        },
        evaluate: async () => ({ nodes: 1, width: 1280, height: 800 }),
        close: async () => {},
      };
      return { newPage: async () => page, close: async () => {} };
    },
  },
}));

const workspace = mkdtempSync(join(tmpdir(), 'codesign-harness-doc-'));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  browser.navigations.length = 0;
});

function onlyNavigation() {
  expect(browser.navigations).toHaveLength(1);
  const [navigation] = browser.navigations;
  if (navigation === undefined) throw new Error('no navigation recorded');
  return navigation;
}

describe('harness documents for sandboxed system Chrome (#455)', () => {
  it('serves the done verifier document from memory instead of a shared temp file', async () => {
    const errors = await makeRuntimeVerifier()('<main id="verify-marker">ok</main>', {
      path: 'index.html',
    });

    const navigation = onlyNavigation();
    expect(errors).toEqual([]);
    expect(navigation.url).toMatch(/^file:.*verify\.html$/);
    expect(navigation.existedOnDisk).toBe(false);
    expect(navigation.request.continue).not.toHaveBeenCalled();
    expect(navigation.request.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: expect.stringContaining('verify-marker'),
      }),
    );
  });

  it('serves the preview document from memory instead of a shared temp file', async () => {
    writeFileSync(join(workspace, 'index.html'), '<main id="preview-marker">ok</main>', 'utf8');

    const result = await runPreview({
      workspaceRoot: workspace,
      path: 'index.html',
      vision: false,
    });

    const navigation = onlyNavigation();
    expect(result.ok).toBe(true);
    expect(navigation.url).toMatch(/^file:.*preview\.html$/);
    expect(navigation.existedOnDisk).toBe(false);
    expect(navigation.request.continue).not.toHaveBeenCalled();
    expect(navigation.request.respond).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('preview-marker') }),
    );
  });

  it('matches only the exact harness document URL', () => {
    const documentPath = join(tmpdir(), 'codesign-done-verify-x', 'verify.html');
    const documentUrl = pathToFileURL(documentPath).href;
    expect(isHarnessDocumentRequest(documentUrl, documentPath)).toBe(true);
    expect(isHarnessDocumentRequest(`${documentUrl}.bak`, documentPath)).toBe(false);
    expect(isHarnessDocumentRequest('https://example.com/verify.html', documentPath)).toBe(false);
    expect(isHarnessDocumentRequest('not a url', documentPath)).toBe(false);
  });
});
