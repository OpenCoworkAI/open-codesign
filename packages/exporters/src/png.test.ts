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

  it('keeps a saved PNG and removes the profile when Chrome fails to close', async () => {
    closeMock.mockRejectedValueOnce(new Error('close failed'));
    const { exportPng } = await import('./png');
    const dest = join(tempDir, 'close-fails.png');

    await expect(exportPng('<p>x</p>', dest)).resolves.toEqual({
      bytes: fakePngBytes.length,
      path: dest,
    });
    expect(readFileSync(dest)).toEqual(fakePngBytes);
    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining('codesign-png-'), {
      recursive: true,
      force: true,
    });
  });

  it('reports the capture error and removes the profile when Chrome also fails to close', async () => {
    screenshotMock.mockRejectedValueOnce(new Error('boom'));
    closeMock.mockRejectedValueOnce(new Error('close failed'));
    const { exportPng } = await import('./png');

    await expect(exportPng('<p>x</p>', join(tempDir, 'both-fail.png'))).rejects.toMatchObject({
      code: 'EXPORTER_PNG_FAILED',
      message: 'PNG export failed: boom',
    });
    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining('codesign-png-'), {
      recursive: true,
      force: true,
    });
  });
});
