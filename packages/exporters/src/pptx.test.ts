import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const defaultFallbackSlideSelector =
  '[data-slide], [data-pptx-slide], [data-slide-container], .slide';

vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock },
}));

vi.mock('./chrome-discovery', () => ({
  findSystemChrome: vi.fn(async () => '/tmp/fake-chrome'),
}));

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-pptx-test-'));
});

beforeEach(() => {
  vi.clearAllMocks();
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

function mockPaginationPageCount(pageCount: number): void {
  evaluateMock.mockImplementation(async (source: unknown) =>
    typeof source === 'function' ? { pageCount } : undefined,
  );
}

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

  it('preserves literal comparison text and named entities while stripping tags', () => {
    const slides = extractSlides(
      '<section><h1>Metrics</h1><p>2 < 3 &amp;&amp; Tom&apos;s ratio&colon; 5 > 4</p></section>',
    );

    expect(slides[0]?.bullets).toEqual(["2 < 3 && Tom's ratio: 5 > 4"]);
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

  it('uses slide-like containers when section elements are absent', async () => {
    querySectionsMock.mockImplementation(async (selector: string) =>
      selector === 'section' ? [] : [{ boundingBox: sectionBoundingBoxMock }],
    );
    const dest = join(tempDir, 'slide-class-visual.pptx');

    await exportPptx('<div class="slide"><h1>Visual</h1></div>', dest);

    expect(querySectionsMock).toHaveBeenNthCalledWith(1, 'section');
    expect(querySectionsMock).toHaveBeenNthCalledWith(2, defaultFallbackSlideSelector);
    expect(screenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'png', clip: expect.any(Object) }),
    );
  });

  it('uses a caller-provided fallback slide selector', async () => {
    querySectionsMock.mockImplementation(async (selector: string) =>
      selector === '[data-slide-container]' ? [{ boundingBox: sectionBoundingBoxMock }] : [],
    );
    const dest = join(tempDir, 'custom-slide-selector.pptx');

    await exportPptx('<article data-slide-container><h1>Visual</h1></article>', dest, {
      slideSelector: '[data-slide-container]',
    });

    expect(querySectionsMock).toHaveBeenNthCalledWith(1, 'section');
    expect(querySectionsMock).toHaveBeenNthCalledWith(2, '[data-slide-container]');
    expect(screenshotMock).toHaveBeenCalledTimes(1);
  });

  it('paginates sectionless documents into viewport-sized screenshots', async () => {
    querySectionsMock.mockResolvedValue([]);
    mockPaginationPageCount(3);
    const dest = join(tempDir, 'sectionless-visual.pptx');

    await exportPptx('<main><h1>Long artifact</h1></main>', dest);

    expect(screenshotMock).toHaveBeenCalledTimes(3);
    expect(screenshotMock).toHaveBeenNthCalledWith(1, {
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    });
    expect(screenshotMock).toHaveBeenNthCalledWith(2, {
      type: 'png',
      clip: { x: 0, y: 720, width: 1280, height: 720 },
    });
    expect(screenshotMock).toHaveBeenNthCalledWith(3, {
      type: 'png',
      clip: { x: 0, y: 1440, width: 1280, height: 720 },
    });
    expect(screenshotMock).not.toHaveBeenCalledWith(expect.objectContaining({ fullPage: true }));
  });

  it('keeps short sectionless documents to one viewport-sized screenshot', async () => {
    querySectionsMock.mockResolvedValue([]);
    mockPaginationPageCount(1);
    const dest = join(tempDir, 'short-sectionless-visual.pptx');

    await exportPptx('<main><h1>Short artifact</h1></main>', dest);

    expect(screenshotMock).toHaveBeenCalledTimes(1);
    expect(screenshotMock).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    });
  });

  it('exports an empty sectionless document as one screenshot slide', async () => {
    querySectionsMock.mockResolvedValue([]);
    mockPaginationPageCount(1);
    const dest = join(tempDir, 'empty-sectionless-visual.pptx');

    await exportPptx('', dest);

    expect(screenshotMock).toHaveBeenCalledTimes(1);
    expect(screenshotMock).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    });
  });

  it('wraps JSX source before screenshotting PPTX slides', async () => {
    setContentMock.mockClear();
    const dest = join(tempDir, 'jsx-visual.pptx');
    await exportPptx(
      'function App() { return <section><h1>Visual JSX</h1></section>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      dest,
    );

    expect(setContentMock).toHaveBeenCalledWith(
      expect.stringContaining('CODESIGN_STANDALONE_RUNTIME'),
      expect.objectContaining({ waitUntil: 'networkidle0' }),
    );
  });
});
