import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportHtml, findSystemChrome } from '@open-codesign/exporters';
import { exportZip } from '@open-codesign/exporters/zip';
import JSZip from 'jszip';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runPreviewSteps } from './preview-interactions';
import { buildWorkspacePreviewDocument } from './preview-runtime';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from './snapshots-db';
import { registerWorkspaceIpc } from './snapshots-ipc';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('./electron-runtime', () => ({
  app: {
    getPath: () => {
      throw new Error('No application data access in this test');
    },
  },
  dialog: {},
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const chrome = await findSystemChrome().catch((error: unknown) => {
  if (error instanceof Error && 'code' in error && error.code === 'EXPORTER_NO_CHROME') {
    return null;
  }
  throw error;
});

describe.skipIf(chrome === null)('workspace artifact integrity main chain', () => {
  let browser: Browser;
  let scratch: string;
  beforeAll(async () => {
    if (chrome === null) throw new Error('System Chrome unavailable');
    scratch = await mkdtemp(path.join(tmpdir(), 'codesign-integrity-browser-'));
    browser = await puppeteer.launch({
      executablePath: chrome,
      userDataDir: path.join(scratch, 'browser-profile'),
      headless: true,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      ],
    });
  });
  afterAll(async () => {
    await browser?.close();
    if (scratch) await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  });

  async function assertRendered(page: Page, file: string, title: string) {
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(`document.querySelector('h1')?.textContent === ${JSON.stringify(title)}
      && Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)`);
    const steps = await runPreviewSteps(page, [
      { action: 'assert', selector: 'h1', text: title },
      { action: 'fill', selector: '#legend-input', value: 'Legend still enabled' },
      { action: 'assert', selector: '#legend-input', value: 'Legend still enabled' },
    ]);
    expect(steps.every((step) => step.ok)).toBe(true);
    const blocked = await runPreviewSteps(page, [
      { action: 'fill', selector: '#disabled-input', value: 'must not change' },
    ]);
    expect(blocked[0]).toMatchObject({ ok: false });
    expect(await page.evaluate(`document.querySelector('#disabled-input').value`)).toBe(
      'untouched',
    );
  }

  for (const sourcePath of ['index.html', 'App.jsx']) {
    it(`preserves ${sourcePath} through source, preview, save/conflict, and offline HTML/ZIP`, async () => {
      const workspace = path.join(scratch, sourcePath.replace('.', '-'));
      await mkdir(path.join(workspace, 'assets'), { recursive: true });
      const asset =
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="green"/></svg>';
      await writeFile(path.join(workspace, 'assets', 'mark.svg'), asset);
      const body = `<main><h1>Seeded source</h1><img src="assets/mark.svg" alt="Local mark" /><fieldset disabled><legend><input id="legend-input" /></legend><input id="disabled-input" value="untouched" /></fieldset></main>`;
      const source = sourcePath.endsWith('.jsx')
        ? `function App() { return (${body}); }`
        : `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
      const db = initInMemoryDb();
      const design = createDesign(db, 'Integrity fixture');
      const sibling = createDesign(db, 'Shared workspace fixture');
      updateDesignWorkspace(db, design.id, workspace);
      updateDesignWorkspace(db, sibling.id, workspace);
      registerWorkspaceIpc(db, () => null);
      const write = handlers.get('codesign:files:v1:write');
      const read = handlers.get('codesign:files:v1:read');
      if (!write || !read) throw new Error('Workspace IPC not registered');
      await write(null, {
        schemaVersion: 1,
        designId: design.id,
        path: sourcePath,
        content: source,
      });
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (/^https?:/u.test(request.url())) void request.abort('blockedbyclient');
        else void request.continue();
      });
      try {
        const previewPath = path.join(workspace, 'preview.html');
        await writeFile(
          previewPath,
          await buildWorkspacePreviewDocument(
            await readFile(path.join(workspace, sourcePath), 'utf8'),
            workspace,
            sourcePath,
          ),
        );
        await assertRendered(page, previewPath, 'Seeded source');
        const savedSource = source.replace('Seeded source', 'Saved source');
        const saves = await Promise.allSettled([
          write(null, {
            schemaVersion: 1,
            designId: design.id,
            path: sourcePath,
            content: savedSource,
            expectedContent: source,
          }),
          write(null, {
            schemaVersion: 1,
            designId: sibling.id,
            path: sourcePath,
            content: savedSource,
            expectedContent: source,
          }),
        ]);
        expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(saves.find((result) => result.status === 'rejected')).toMatchObject({
          reason: { code: 'IPC_CONFLICT' },
        });
        expect(
          await read(null, { schemaVersion: 1, designId: design.id, path: sourcePath }),
        ).toMatchObject({
          content: savedSource,
        });
        const diskSource = await readFile(path.join(workspace, sourcePath), 'utf8');
        await writeFile(
          previewPath,
          await buildWorkspacePreviewDocument(diskSource, workspace, sourcePath),
        );
        await assertRendered(page, previewPath, 'Saved source');
        const options = { assetRootPath: workspace, assetBasePath: workspace, sourcePath };
        const htmlPath = path.join(workspace, 'export.html');
        await exportHtml(diskSource, htmlPath, options);
        await assertRendered(page, htmlPath, 'Saved source');
        const zipPath = path.join(workspace, 'export.zip');
        await exportZip(diskSource, zipPath, options);
        const archive = await JSZip.loadAsync(await readFile(zipPath));
        expect(await archive.file(`source/${sourcePath}`)?.async('string')).toBe(savedSource);
        const extracted = path.join(workspace, 'extracted');
        await mkdir(path.join(extracted, 'assets'), { recursive: true });
        for (const entry of ['index.html', 'assets/mark.svg']) {
          const file = archive.file(entry);
          if (!file) throw new Error(`Missing ZIP entry: ${entry}`);
          await writeFile(path.join(extracted, entry), await file.async('nodebuffer'));
        }
        await assertRendered(page, path.join(extracted, 'index.html'), 'Saved source');
        expect(pageErrors).toEqual([]);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});
