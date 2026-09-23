import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportZip } from './zip';

let tempDir = '';

// These disk round-trips include the multi-megabyte standalone JSX runtime;
// Windows file scanning can exceed Vitest's default five-second timeout.
const JSX_ZIP_TIMEOUT_MS = 30_000;

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'codesign-zip-test-')));
  mkdirSync(join(tempDir, 'assets'), { recursive: true });
  writeFileSync(join(tempDir, 'assets', 'logo.svg'), '<svg></svg>');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportZip', () => {
  it('writes a multi-asset bundle with index.html, README.md and assets/', async () => {
    const dest = join(tempDir, 'bundle.zip');
    const result = await exportZip('<h1>hi</h1>', dest, {
      assets: [
        { path: 'assets/logo.svg', content: '<svg></svg>' },
        { path: 'assets/data.bin', content: Buffer.from([1, 2, 3, 4]) },
      ],
      readmeTitle: 'Test bundle',
    });

    expect(existsSync(dest)).toBe(true);
    expect(result.bytes).toBeGreaterThan(100);

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'extracted');
    const unzip = new Unzip();
    await unzip.extract(dest, extractDir);

    expect(existsSync(join(extractDir, 'index.html'))).toBe(true);
    expect(existsSync(join(extractDir, 'README.md'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'logo.svg'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'data.bin'))).toBe(true);

    const { readFile } = await import('node:fs/promises');
    const readme = await readFile(join(extractDir, 'README.md'), 'utf8');
    expect(readme).toContain('Test bundle');
    expect(readme).toContain('open-codesign');
  });

  it('produces a valid zip without any extra assets', async () => {
    const dest = join(tempDir, 'minimal.zip');
    const result = await exportZip('<p>x</p>', dest);
    expect(result.bytes).toBeGreaterThan(50);
  });

  it(
    'writes JSX source as browser-openable index.html',
    async () => {
      const dest = join(tempDir, 'jsx-bundle.zip');
      await exportZip(
        'function App() { return <main id="zip-jsx">ZIP</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
        dest,
      );

      const { Unzip } = await import('zip-lib');
      const extractDir = join(tempDir, 'jsx-extracted');
      const unzip = new Unzip();
      await unzip.extract(dest, extractDir);

      const out = readFileSync(join(extractDir, 'index.html'), 'utf8');
      expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
      expect(out).toContain('zip-jsx');
      expect(out).not.toContain('https://cdn.tailwindcss.com');
    },
    JSX_ZIP_TIMEOUT_MS,
  );

  it(
    'bundles the original source and export manifest for handoff quality',
    async () => {
      const dest = join(tempDir, 'source-manifest.zip');
      await exportZip(
        'function App() { return <main id="zip-source">ZIP</main>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
        dest,
        { sourcePath: 'screens/App.tsx', readmeTitle: 'Source manifest' },
      );

      const { Unzip } = await import('zip-lib');
      const extractDir = join(tempDir, 'source-manifest-extracted');
      const unzip = new Unzip();
      await unzip.extract(dest, extractDir);

      expect(readFileSync(join(extractDir, 'source', 'screens', 'App.tsx'), 'utf8')).toContain(
        'zip-source',
      );
      const manifest = JSON.parse(readFileSync(join(extractDir, 'manifest.json'), 'utf8')) as {
        schemaVersion: number;
        sourcePath: string;
        files: string[];
      };
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.sourcePath).toBe('screens/App.tsx');
      expect(manifest.files).toContain('source/screens/App.tsx');
    },
    JSX_ZIP_TIMEOUT_MS,
  );

  it('auto-collects local asset references and rewrites root-relative paths', async () => {
    const dest = join(tempDir, 'auto-assets.zip');
    await exportZip('<img src="/assets/logo.svg">', dest, {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'auto-extracted');
    const unzip = new Unzip();
    await unzip.extract(dest, extractDir);

    expect(existsSync(join(extractDir, 'assets', 'logo.svg'))).toBe(true);
    expect(readFileSync(join(extractDir, 'index.html'), 'utf8')).toContain('src="assets/logo.svg"');
  });

  it(
    'collects JSX assets before serialization while preserving editable source',
    async () => {
      const source = 'function App() { return <img src="../assets/logo.svg" />; }';
      const dest = join(tempDir, 'jsx-assets.zip');
      await exportZip(source, dest, {
        sourcePath: 'screens/App.jsx',
        assetBasePath: join(tempDir, 'screens'),
        assetRootPath: tempDir,
      });
      const { Unzip } = await import('zip-lib');
      const extractDir = join(tempDir, 'jsx-assets-extracted');
      await new Unzip().extract(dest, extractDir);
      expect(readFileSync(join(extractDir, 'assets', 'logo.svg'), 'utf8')).toBe('<svg></svg>');
      expect(readFileSync(join(extractDir, 'index.html'), 'utf8')).toContain(
        'src=\\"assets/logo.svg\\"',
      );
      expect(readFileSync(join(extractDir, 'source', 'screens', 'App.jsx'), 'utf8')).toBe(source);
    },
    JSX_ZIP_TIMEOUT_MS,
  );

  it('bundles workspace DESIGN.md when present', async () => {
    writeFileSync(join(tempDir, 'DESIGN.md'), '---\nversion: alpha\nname: Zip Test\n---\n', 'utf8');
    const dest = join(tempDir, 'design-md.zip');
    await exportZip('<p>x</p>', dest, {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'design-md-extracted');
    const unzip = new Unzip();
    await unzip.extract(dest, extractDir);

    expect(readFileSync(join(extractDir, 'DESIGN.md'), 'utf8')).toContain('Zip Test');
  });

  it.runIf(process.env['CODESIGN_EXPORT_BROWSER_TESTS'] === '1').each(['html', 'jsx'])(
    'renders extracted %s ZIP assets with encoded spaces, quotes, and parentheses offline',
    async (format) => {
      const { findSystemChrome } = await import('./chrome-discovery');
      const { default: puppeteer } = await import('puppeteer-core');
      const { Unzip } = await import('zip-lib');
      const filenames = ['space image.svg', "it's (local).svg"];
      const assetDir = join(tempDir, 'assets', 'brand images');
      mkdirSync(assetDir, { recursive: true });
      for (const filename of filenames) {
        writeFileSync(
          join(assetDir, filename),
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
        );
      }
      const urls = [
        'assets/brand%20images/space%20image.svg?v=1#icon',
        'assets/brand%20images/it%27s%20%28local%29.svg?v=2#icon',
      ];
      const markup = urls
        .map((url, index) =>
          format === 'jsx'
            ? `<div id="background-${index}" style={{backgroundImage:"url(../${url})",width:16,height:16}} /><img id="image-${index}" src="../${url}" />`
            : `<div id="background-${index}" style="background-image:url(../${url});width:16px;height:16px"></div><img id="image-${index}" src="../${url}">`,
        )
        .join('');
      const source =
        format === 'jsx'
          ? `function App() { return <main>${markup}</main>; }`
          : `<!doctype html><html><body>${markup}</body></html>`;
      const dest = join(tempDir, `encoded-${format}.zip`);
      await exportZip(source, dest, {
        sourcePath: `screens/App.${format}`,
        assetBasePath: join(tempDir, 'screens'),
        assetRootPath: tempDir,
      });
      const extractDir = join(tempDir, `encoded-${format}-extracted`);
      await new Unzip().extract(dest, extractDir);
      for (const filename of filenames) {
        expect(existsSync(join(extractDir, 'assets', 'brand images', filename))).toBe(true);
      }
      expect(readFileSync(join(extractDir, 'source', 'screens', `App.${format}`), 'utf8')).toBe(
        source,
      );

      const browser = await puppeteer.launch({
        executablePath: await findSystemChrome(),
        headless: true,
        pipe: true,
        userDataDir: join(tempDir, `browser-profile-${format}`),
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
        const indexUrl = pathToFileURL(join(extractDir, 'index.html')).href;
        await page.goto(indexUrl);
        await page.waitForSelector('#background-1');
        for (const [index, url] of urls.entries()) {
          const expectedUrl = new URL(url, indexUrl).href;
          expect(
            await page.$eval(
              `#background-${index}`,
              (node) => getComputedStyle(node).backgroundImage,
            ),
          ).toBe(`url("${expectedUrl}")`);
          // Decode the browser-parsed CSS URL, not just an independently constructed fixture URL.
          expect(
            await page.$eval(`#background-${index}`, async (node) => {
              const image = new Image();
              image.src = getComputedStyle(node).backgroundImage.slice(5, -2);
              await image.decode();
              return image.naturalWidth;
            }),
          ).toBe(16);
          expect(
            await page.$eval(`#image-${index}`, async (node) => {
              if (!(node instanceof HTMLImageElement)) return 0;
              await node.decode();
              return node.naturalWidth;
            }),
          ).toBe(16);
        }
        expect(errors).toEqual([]);
        expect(external).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    JSX_ZIP_TIMEOUT_MS,
  );

  it('throws EXPORTER_ZIP_FAILED when the destination cannot be written', async () => {
    // Pass a directory as the destination — zip-lib will fail to write a regular file there.
    await expect(exportZip('<p>x</p>', tempDir)).rejects.toMatchObject({
      code: 'EXPORTER_ZIP_FAILED',
    });
  });

  it('rejects asset paths that escape the staging directory (zip-slip)', async () => {
    const dest = join(tempDir, 'unsafe.zip');
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: '../escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: 'assets/../../escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    // Windows-style backslash traversal — must be rejected on POSIX too,
    // since ZIP entries authored on Windows can carry `\` separators.
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: '..\\..\\etc\\passwd', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
    await expect(
      exportZip('<p>x</p>', dest, {
        assets: [{ path: 'assets\\..\\..\\escape.txt', content: 'pwn' }],
      }),
    ).rejects.toMatchObject({ code: 'EXPORTER_ZIP_UNSAFE_PATH' });
  });
});
