import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHtmlDocument, buildInlineHtmlDocument, exportHtml } from './html';
import { buildExportHtmlDocument } from './rendered-html';

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-html-test-'));
  mkdirSync(join(tempDir, 'assets'), { recursive: true });
  writeFileSync(join(tempDir, 'assets', 'logo.svg'), '<svg></svg>');
  mkdirSync(join(tempDir, 'screens'), { recursive: true });
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('buildHtmlDocument', () => {
  it('exports JSX source as browser-openable HTML with the standalone runtime', () => {
    const out = buildHtmlDocument(
      'function App() { return <div className="p-4">hi</div>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { prettify: false },
    );

    expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
    expect(out).toContain('window.Babel.transform');
    expect(out).not.toContain('https://cdn.tailwindcss.com');
    expect(out).not.toContain('CODESIGN_OVERLAY_SCRIPT');
  });

  it('can inject Tailwind CDN when explicitly requested', () => {
    const out = buildHtmlDocument('function App() { return <main />; }', {
      injectTailwind: true,
      prettify: false,
    });

    expect(out).toContain('https://cdn.tailwindcss.com');
  });

  it.each([
    'assets/app.js',
    'https://example.com/app.js',
  ])('does not duplicate Tailwind when followed by %s', (scriptSrc) => {
    const out = buildHtmlDocument(
      `<html><head><script src="https://cdn.tailwindcss.com"></script><script src="${scriptSrc}"></script></head><body>hi</body></html>`,
      { injectTailwind: true, prettify: false },
    );

    expect(out.match(/src="https:\/\/cdn\.tailwindcss\.com"/g)).toHaveLength(1);
  });

  it('uses sourcePath to preserve TSX transform options during export', () => {
    const out = buildHtmlDocument(
      'type Props = { title: string };\nfunction App({ title }: Props) { return <main>{title}</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App title="hi" />);',
      { prettify: false, sourcePath: 'screens/App.tsx' },
    );

    expect(out).toContain('"typescript"');
    expect(out).toContain('"isTSX":true');
    expect(out).toContain('artifact.tsx');
  });

  it('keeps legacy HTML fragments as HTML when no sourcePath is provided', () => {
    const out = buildHtmlDocument('<main id="legacy-html">hi</main>', { prettify: false });

    expect(out).toContain('<main id="legacy-html">hi</main>');
    expect(out).not.toContain('CODESIGN_STANDALONE_RUNTIME');
  });

  it('does not mutate script string literals while prettifying standalone JSX exports', () => {
    const out = buildHtmlDocument(
      'const svg = "<svg><path d=\\"M0 0\\" /></svg>";\nfunction App() { return <main>{svg}</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
    );

    expect(out).toContain('const svg =');
    expect(out).toContain('M0 0');
    expect(out).not.toContain('<svg>\n<path');
  });

  it('writes a self-contained HTML file with local assets inlined', async () => {
    const dest = join(tempDir, 'out.html');
    await exportHtml('<img src="assets/logo.svg">', dest, {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
      prettify: false,
    });

    const out = readFileSync(dest, 'utf8');
    expect(out).toContain('src="data:image/svg+xml;charset=utf-8,');
    expect(out).not.toContain('src="assets/logo.svg"');
  });

  it.each([
    'App.jsx',
    'App.tsx',
  ])('inlines quoted JSX attributes before encoding %s', async (name) => {
    const source = 'function App() { return <img src="../assets/logo.svg" />; }';
    const opts = {
      sourcePath: `screens/${name}`,
      assetBasePath: join(tempDir, 'screens'),
      assetRootPath: tempDir,
      injectTailwind: false,
      prettify: false,
    };
    const dest = join(tempDir, `${name}.html`);
    await exportHtml(source, dest, opts);
    const html = readFileSync(dest, 'utf8');
    const renderHtml = await buildExportHtmlDocument(source, opts);
    for (const document of [html, renderHtml]) {
      expect(document).toContain('src=\\"data:image/svg+xml;charset=utf-8,');
      expect(document).not.toContain('../assets/logo.svg');
    }
  }, 30_000);

  it('keeps explicit asset opt-out and nonlocal references unchanged', async () => {
    const source = 'function App() { return <img src="assets/logo.svg" />; }';
    const html = await buildInlineHtmlDocument(source, {
      assetBasePath: tempDir,
      inlineLocalAssets: false,
    });
    expect(html).toContain('src=\\"assets/logo.svg\\"');
    const remote = await buildInlineHtmlDocument(
      'function App() { return <img src="https://example.com/logo.svg" />; }',
      { assetBasePath: tempDir },
    );
    expect(remote).toContain('src=\\"https://example.com/logo.svg\\"');
  });

  it.runIf(process.env['CODESIGN_EXPORT_BROWSER_TESTS'] === '1')(
    'renders portable JSX images and CSS offline without changing interaction behavior',
    async () => {
      const { findSystemChrome } = await import('./chrome-discovery');
      const { default: puppeteer } = await import('puppeteer-core');
      writeFileSync(
        join(tempDir, 'assets', 'render.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><title>It\'s (local)</title><rect width="16" height="16" fill="blue"/></svg>',
      );
      const source = `function App() {
        const [count, setCount] = React.useState(0);
        return <main>
          <img id="image" src='assets/render.svg' />
          <div id="background" style={{backgroundImage:"url(assets/render.svg)"}}>Background</div>
          <button onClick={() => setCount(count + 1)}>{count}</button>
        </main>;
      }`;
      const dest = join(tempDir, 'portable-browser.html');
      await exportHtml(source, dest, { assetBasePath: tempDir, assetRootPath: tempDir });
      const browser = await puppeteer.launch({
        executablePath: await findSystemChrome(),
        headless: true,
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        const external: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        page.on('request', (request) => {
          if (/^https?:/.test(request.url())) external.push(request.url());
        });
        await page.setOfflineMode(true);
        await page.goto(pathToFileURL(dest).href);
        await page.waitForFunction(() => {
          const image = document.getElementById('image');
          return image instanceof HTMLImageElement && image.naturalWidth === 16;
        });
        await page.click('button');
        expect(await page.$eval('button', (button) => button.textContent)).toBe('1');
        expect(
          await page.$eval('#background', (node) => getComputedStyle(node).backgroundImage),
        ).toContain('data:image/svg+xml');
        expect(errors).toEqual([]);
        expect(external).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});
