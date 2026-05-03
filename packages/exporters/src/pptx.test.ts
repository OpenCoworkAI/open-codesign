import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportPptx, extractSlides } from './pptx';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const launchMock = vi.fn();
const newPageMock = vi.fn();
const setViewportMock = vi.fn();
const setContentMock = vi.fn();
const evaluateMock = vi.fn();
const screenshotMock = vi.fn();
const closeMock = vi.fn();
const sectionBoundingBoxMock = vi.fn();
const querySectionsMock = vi.fn();

vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock },
}));

vi.mock('./chrome-discovery', () => ({
  findSystemChrome: vi.fn(async () => '/tmp/fake-chrome'),
}));

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-pptx-test-'));
  launchMock.mockResolvedValue({
    newPage: newPageMock,
    close: closeMock,
  });
  newPageMock.mockResolvedValue({
    setViewport: setViewportMock,
    setContent: setContentMock,
    evaluate: evaluateMock,
    screenshot: screenshotMock,
    $$: querySectionsMock,
  });
  evaluateMock.mockResolvedValue(undefined);
  screenshotMock.mockResolvedValue(pngBytes);
  sectionBoundingBoxMock.mockResolvedValue({ x: 0, y: 0, width: 1280, height: 720 });
  querySectionsMock.mockResolvedValue([{ boundingBox: sectionBoundingBoxMock }]);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('extractSlides', () => {
  it('treats each <section> as a slide and pulls the heading + bullets', () => {
    const html = `
      <section><h1>One</h1><ul><li>alpha</li><li>beta</li></ul></section>
      <section><h2>Two</h2><p>paragraph body</p></section>
    `;
    const slides = extractSlides(html);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toEqual({ title: 'One', bullets: ['alpha', 'beta'] });
    expect(slides[1]).toEqual({ title: 'Two', bullets: ['paragraph body'] });
  });

  it('falls back to a single slide when no <section> exists', () => {
    const slides = extractSlides('<h1>Solo</h1><p>body</p>');
    expect(slides).toEqual([{ title: 'Solo', bullets: ['body'] }]);
  });

  it('preserves CJK characters end-to-end', () => {
    const slides = extractSlides('<section><h1>你好</h1><p>世界</p></section>');
    expect(slides[0]).toEqual({ title: '你好', bullets: ['世界'] });
  });

  it('strips inline <style> and <script> blocks from text content', () => {
    const slides = extractSlides(
      '<section><h1>x</h1><style>h1{color:red}</style><p>visible</p></section>',
    );
    expect(slides[0]?.bullets).toEqual(['visible']);
  });
});

describe('exportPptx', () => {
  it('writes a real .pptx with a CJK slide that downstream tools can open', async () => {
    const dest = join(tempDir, 'cjk.pptx');
    const result = await exportPptx(
      '<section><h1>你好世界</h1><p>第一张幻灯片</p></section>',
      dest,
      { deckTitle: 'CJK smoke test', renderMode: 'editable' },
    );

    expect(existsSync(dest)).toBe(true);
    expect(result.path).toBe(dest);
    expect(result.bytes).toBeGreaterThan(1000);

    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(dest);
    // PPTX is a zip; magic bytes are PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  }, 20_000);

  it('throws EXPORTER_PPTX_FAILED on writeFile errors', async () => {
    await expect(
      exportPptx('<section>x</section>', join(tempDir, 'nope', 'missing-dir', 'fail.pptx'), {
        renderMode: 'editable',
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_PPTX_FAILED' });
  });

  it('renders rich HTML slides as screenshots by default', async () => {
    const dest = join(tempDir, 'visual.pptx');
    const result = await exportPptx('<section><h1>Visual</h1><img src="hero.png"></section>', dest);

    expect(result.bytes).toBeGreaterThan(1000);
    expect(launchMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/tmp/fake-chrome' }),
    );
    expect(querySectionsMock).toHaveBeenCalled();
    expect(screenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'png', clip: expect.any(Object) }),
    );
  });
});
