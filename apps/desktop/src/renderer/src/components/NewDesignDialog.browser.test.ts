import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import type { SourceEntryResultV1 } from '@open-codesign/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build, type PreviewServer, preview } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initInMemoryDb, listDesigns } from '../../../main/snapshots-db';
import { registerSnapshotsIpc } from '../../../main/snapshots-ipc';
import { getSourceEntry } from '../../../main/source-entry';

type Handler = (event: unknown, input: unknown) => unknown;
const host = vi.hoisted(() => ({ root: '', handlers: new Map<string, Handler>() }));
vi.mock('../../../main/electron-runtime', () => ({
  app: { getPath: () => host.root },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (name: string, handler: Handler) => host.handlers.set(name, handler) },
}));
vi.mock('../../../main/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const fixture = 'src/renderer/src/components/__fixtures__/new-design-browser.html';
const evidence = resolve(
  '../../.Codex/workspace/validation/new-design-choice',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

describe('new design format: production dialog/store → real creation IPC → source metadata', () => {
  let browser: Browser,
    page: Page,
    server: PreviewServer,
    directory: string,
    endpoint: string,
    imported: string;
  const errors: string[] = [];
  beforeAll(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'codesign-create-choice-')));
    host.root = directory;
    imported = join(directory, 'existing');
    await mkdir(imported);
    await writeFile(
      join(imported, 'App.jsx'),
      'function App(){return <main>Existing React</main>}',
    );
    const db = { ...initInMemoryDb(), sessionDir: join(directory, 'sessions') };
    registerSnapshotsIpc(db);
    const outDir = join(directory, 'site');
    await mkdir(evidence, { recursive: true });
    await build({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      build: { outDir, target: 'esnext', rollupOptions: { input: resolve(fixture) } },
    });
    server = await preview({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'new-design-real-ipc',
          configurePreviewServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url === '/favicon.ico') {
                res.statusCode = 204;
                res.end();
                return;
              }
              if (!req.url?.startsWith('/bridge/')) {
                next();
                return;
              }
              const method = req.url.slice('/bridge/'.length);
              void (async () => {
                try {
                  let raw = '';
                  for await (const chunk of req) raw += String(chunk);
                  const args: unknown[] = JSON.parse(raw);
                  let result: unknown;
                  if (method === 'create') {
                    const handler = host.handlers.get('snapshots:v1:create-design');
                    if (!handler) throw new Error('Missing creation handler');
                    result = await handler(null, {
                      schemaVersion: 1,
                      name: args[0],
                      workspacePath: args[1],
                      ...(args[2] != null ? { demoInputId: args[2] } : {}),
                      ...(args[3] != null ? { authoringFormat: args[3] } : {}),
                    });
                  } else if (method === 'list') result = listDesigns(db);
                  else if (method === 'pick') result = imported;
                  else if (method === 'entry' && typeof args[0] === 'string')
                    result = await getSourceEntry(db, args[0]);
                  else throw new Error('Unknown creation method');
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = 500;
                  res.end(String(error));
                }
              })();
            });
          },
        },
      ],
    });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing browser server');
    endpoint = `http://127.0.0.1:${address.port}/${fixture}`;
    const chrome = await findSystemChrome();
    if (!chrome) throw new Error('System Chrome required');
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox'],
    });
  }, 60_000);
  beforeEach(async () => {
    errors.length = 0;
    page = await browser.newPage();
    await page.setViewport({ width: 980, height: 720 });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${endpoint}?locale=zh`);
    await page.waitForSelector('[role="dialog"]');
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished)),
    );
  });
  afterEach(async () => {
    await page.close();
    expect(errors).toEqual([]);
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((done) => server?.httpServer.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }, 30_000);
  async function submit(): Promise<SourceEntryResultV1> {
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[data-entry]')?.textContent);
    return JSON.parse(
      await page.$eval('[data-entry]', (node) => node.textContent ?? ''),
    ) as SourceEntryResultV1;
  }
  it('creates native HTML by default from the actual dialog', async () => {
    await page.screenshot({ path: join(evidence, 'html-default.png') });
    expect(await submit()).toMatchObject({
      status: 'planned',
      source: { path: 'index.html', format: 'html', runtimeMode: 'native-html' },
    });
  });
  it('creates an explicit React identity from advanced options', async () => {
    await page.click('summary');
    await page.select('select', 'react');
    expect(await page.$eval('[role="status"]', (node) => node.textContent)).toContain('React');
    await page.screenshot({ path: join(evidence, 'react-advanced.png') });
    expect(await submit()).toMatchObject({
      status: 'planned',
      source: { path: 'App.jsx', format: 'jsx', runtimeMode: 'legacy-auto' },
    });
  });
  it('preserves an existing React folder even after previously selecting HTML', async () => {
    await page.click('button[type="button"]');
    await page.waitForFunction(() => !document.querySelector('select'));
    expect(await page.$eval('[role="status"]', (node) => node.textContent)).toContain('沿用原格式');
    await page.screenshot({ path: join(evidence, 'existing-folder.png') });
    expect(await submit()).toMatchObject({
      status: 'ready',
      source: { path: 'App.jsx', runtimeMode: 'legacy-auto' },
    });
    expect(await readFile(join(imported, 'App.jsx'), 'utf8')).toBe(
      'function App(){return <main>Existing React</main>}',
    );
  });
});
