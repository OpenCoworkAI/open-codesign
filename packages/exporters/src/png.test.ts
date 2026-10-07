import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fakePngBytes = Buffer.from('\x89PNG fake');

const launchMock = vi.fn();
const setViewportMock = vi.fn();
const setContentMock = vi.fn();
const evaluateMock = vi.fn();
const screenshotMock = vi.fn();
const closeMock = vi.fn();
const { rmMock } = vi.hoisted(() => ({ rmMock: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  rmMock.mockImplementation(actual.rm);
  return { ...actual, rm: rmMock };
});

vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock },
}));

vi.mock('./chrome-discovery', () => ({
  findSystemChrome: vi.fn(
    async () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ),
}));

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-png-test-'));
});

beforeEach(() => {
  vi.clearAllMocks();
  launchMock.mockResolvedValue({
    newPage: async () => ({
      setViewport: setViewportMock,
      setContent: setContentMock,
      evaluate: evaluateMock,
      screenshot: screenshotMock,
    }),
    close: closeMock,
  });
  screenshotMock.mockResolvedValue(fakePngBytes);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportPng', () => {
  it('writes a full-page 2x screenshot of the rendered document', async () => {
    const { EXPAND_DECK_SCRIPT, exportPng } = await import('./png');
    const dest = join(tempDir, 'out.png');

    const result = await exportPng('<h1>hi</h1>', dest);

    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: expect.stringContaining('Chrome'),
        headless: true,
      }),
    );
    expect(setViewportMock).toHaveBeenCalledWith({
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
    });
    expect(setContentMock).toHaveBeenCalledWith(expect.stringContaining('<h1>hi</h1>'), {
      waitUntil: 'load',
      timeout: 45_000,
    });
    expect(screenshotMock).toHaveBeenCalledWith({ type: 'png', fullPage: true });
    expect(evaluateMock).toHaveBeenLastCalledWith(EXPAND_DECK_SCRIPT);
    expect(evaluateMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      screenshotMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(readFileSync(dest)).toEqual(fakePngBytes);
    expect(result).toEqual({ bytes: fakePngBytes.length, path: dest });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('uses a caller-provided viewport', async () => {
    const { exportPng } = await import('./png');

    await exportPng('<p>x</p>', join(tempDir, 'narrow.png'), {
      chromePath: '/tmp/fake-chrome',
      viewport: { width: 390, height: 844 },
    });

    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/tmp/fake-chrome' }),
    );
    expect(setViewportMock).toHaveBeenCalledWith({ width: 390, height: 844, deviceScaleFactor: 2 });
  });

  it('keeps a saved PNG when the temporary Chrome profile cannot be removed', async () => {
    rmMock.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    const { exportPng } = await import('./png');
    const dest = join(tempDir, 'locked-profile.png');

    await expect(exportPng('<p>x</p>', dest)).resolves.toEqual({
      bytes: fakePngBytes.length,
      path: dest,
    });
  });

  it('wraps browser failures in EXPORTER_PNG_FAILED and still closes Chrome', async () => {
    screenshotMock.mockRejectedValueOnce(new Error('boom'));
    const { exportPng } = await import('./png');

    await expect(exportPng('<p>x</p>', join(tempDir, 'fail.png'))).rejects.toMatchObject({
      code: 'EXPORTER_PNG_FAILED',
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe.runIf(process.env['CODESIGN_EXPORT_BROWSER_TESTS'] === '1')(
  'deck layout in system Chrome',
  () => {
    async function layoutInChrome(html: string) {
      const { EXPAND_DECK_SCRIPT } = await import('./png');
      const { findSystemChrome } =
        await vi.importActual<typeof import('./chrome-discovery')>('./chrome-discovery');
      const { default: puppeteer } =
        await vi.importActual<typeof import('puppeteer-core')>('puppeteer-core');
      const browser = await puppeteer.launch({
        executablePath: await findSystemChrome(),
        headless: true,
      });
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setContent(html, { waitUntil: 'load' });
        const laidOut = await page.evaluate(EXPAND_DECK_SCRIPT);
        const tops = await page.$$eval('section', (sections) =>
          sections
            .filter((section) => section.getBoundingClientRect().height > 0)
            .map((section) => section.getBoundingClientRect().top + window.scrollY),
        );
        return { laidOut, tops };
      } finally {
        await browser.close();
      }
    }

    it('stacks every slide of the built-in 16:9 deck scaffold', async () => {
      const scaffold = readFileSync(
        new URL(
          '../../../apps/desktop/resources/templates/scaffolds/decks/slide-16-9.html',
          import.meta.url,
        ),
        'utf8',
      );

      const { laidOut, tops } = await layoutInChrome(scaffold);

      expect(laidOut).toBe(2);
      expect(tops).toHaveLength(2);
      expect(tops[0]).toBeGreaterThanOrEqual(0);
      expect(tops[1]).toBeGreaterThan(tops[0] ?? 0);
    }, 60_000);

    it('leaves pages whose sections are all visible unchanged', async () => {
      const page = `<main>${'<section style="height:160px">Task</section>'.repeat(3)}</main>`;

      const { laidOut, tops } = await layoutInChrome(page);

      expect(laidOut).toBe(0);
      expect(tops).toHaveLength(3);
    }, 60_000);
  },
);
