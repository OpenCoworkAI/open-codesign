import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DesignSystemLibrary } from '../src/main/design-system-library';
import { registerDesignSystemLibraryIpc } from '../src/main/design-system-library-ipc';
import { app } from '../src/main/electron-runtime';
import { getDesign, initSnapshotsDb, listDesigns, listSnapshots } from '../src/main/snapshots-db';
import { registerSnapshotsIpc } from '../src/main/snapshots-ipc';
import { readWorkspaceFileAt } from '../src/main/workspace-reader';

type Handler = (event: unknown, raw: unknown) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('../src/main/electron-runtime', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));
vi.mock('../src/main/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const chrome = await findSystemChrome().catch(() => null);

describe.skipIf(!chrome)('design system library UI with production IPC', () => {
  let root: string;
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let library: DesignSystemLibrary;
  let db: ReturnType<typeof initSnapshotsDb>;
  const errors: string[] = [];
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'system-ui-'));
    vi.mocked(app.getPath).mockImplementation((name) =>
      name === 'documents' ? path.join(root, 'documents') : root,
    );
    const builtinRoot = path.join(root, 'templates', 'brand-refs');
    for (const slug of ['ibm', 'vercel', 'stripe']) {
      await mkdir(path.join(builtinRoot, slug), { recursive: true });
      await writeFile(
        path.join(builtinRoot, slug, 'DESIGN.md'),
        await readFile(path.resolve('resources/templates/brand-refs', slug, 'DESIGN.md'), 'utf8'),
      );
    }
    library = new DesignSystemLibrary({ root: path.join(root, 'design-systems'), builtinRoot });
    db = initSnapshotsDb(path.join(root, 'design-store.json'));
    registerSnapshotsIpc(db);
    registerDesignSystemLibraryIpc(db, library);
    const bridge = (vite: ViteDevServer) => {
      vite.middlewares.use('/library-bridge', (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += String(chunk);
        });
        req.on('end', () => {
          void (async () => {
            try {
              const parsed = JSON.parse(body) as { channel: string; data: Record<string, unknown> };
              let result: unknown;
              if (parsed.channel === 'codesign:files:v1:read') {
                const design = getDesign(db, String(parsed.data['designId']));
                if (!design?.workspacePath) throw new Error('No workspace');
                try {
                  result = await readWorkspaceFileAt(
                    design.workspacePath,
                    String(parsed.data['path']),
                  );
                } catch {
                  result = null;
                }
              } else {
                const handler = handlers.get(parsed.channel);
                if (!handler) throw new Error(`Missing handler ${parsed.channel}`);
                result = await handler(null, parsed.data);
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result ?? null));
            } catch (err) {
              res.statusCode = 500;
              res.end(String(err));
            }
          })();
        });
      });
    };
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'design-system-real-ipc-bridge', configureServer: bridge }],
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    browser = await puppeteer.launch({
      executablePath: chrome ?? '',
      headless: true,
      userDataDir: path.join(root, 'chrome'),
    });
    page = await browser.newPage();
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(
      `http://127.0.0.1:${address.port}/src/renderer/src/views/hub/__fixtures__/library.html`,
      { waitUntil: 'networkidle0', timeout: 90000 },
    );
    await page.waitForSelector('.system-card', { timeout: 15000 }).catch(async () => {
      throw new Error(
        JSON.stringify({ errors, text: await page.$eval('body', (el) => el.innerText) }),
      );
    });
  }, 120000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function clickText(text: string, selector = 'button') {
    await page.waitForFunction(
      (text, selector) =>
        [...document.querySelectorAll(selector)].some((el) => el.textContent?.trim() === text),
      {},
      text,
      selector,
    );
    await page.evaluate(
      (text, selector) => {
        const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
          (el) => el.textContent?.trim() === text,
        );
        if (!element) throw new Error(`Missing ${text}`);
        element.click();
      },
      text,
      selector,
    );
  }
  afterEach(async () => {
    if (page) {
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.system-card');
    }
  });
  it('shows a full content detail with a fitted interactive board and keeps small dialogs centered', async () => {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewport(viewport);
      await page.click('.system-card');
      await page.waitForSelector('.system-detail');
      await page.waitForFunction(
        () =>
          Number(
            document
              .querySelector('.system-preview-stage iframe')
              ?.getAttribute('data-measured-height'),
          ) > 0,
      );
      const evidence = path.resolve('../../docs/validation/design-systems');
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, `system-detail-${viewport.width}.png`) });
      const layout = await page.evaluate(() => {
        const bounds = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(selector);
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          };
        };
        return {
          sidebar: bounds('.system-detail-sidebar'),
          preview: bounds('.system-detail-preview'),
          stage: bounds('.system-preview-stage'),
          frame: bounds('.system-preview-stage iframe'),
          spec: bounds('.system-spec'),
        };
      });
      expect(layout.sidebar.right).toBeLessThanOrEqual(layout.preview.x);
      expect(layout.frame.width).toBeGreaterThan(300);
      expect(layout.frame.x).toBeGreaterThanOrEqual(layout.stage.x - 1);
      expect(layout.frame.bottom).toBeLessThanOrEqual(layout.stage.bottom + 1);
      expect(layout.spec.y).toBeGreaterThan(layout.preview.y);
      expect(layout.spec.bottom).toBeLessThanOrEqual(viewport.height + 1);
      const iframe = await page.$('.system-preview-stage iframe');
      const frame = await iframe?.contentFrame();
      expect(frame).toBeTruthy();
      const documentSize = await frame?.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        viewport: innerHeight,
      }));
      expect(documentSize?.height).toBeLessThanOrEqual(940);
      expect(documentSize?.height).toBeLessThanOrEqual((documentSize?.viewport ?? 0) + 1);
      const button = await frame?.$eval(
        '[data-design-system-role="primary-button"]:not([disabled])',
        (el) => {
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        },
      );
      if (!button) throw new Error('Missing primary action');
      // Puppeteer's frame.click does not account for a scaled iframe's coordinates.
      await page.mouse.click(
        layout.frame.x + (button.x * layout.frame.width) / 1280,
        layout.frame.y + (button.y * layout.frame.width) / 1280,
      );
      await frame?.waitForFunction(
        () => document.querySelector('[role="status"]')?.textContent?.includes('已保存'),
        { timeout: 5000 },
      );
      expect(await frame?.$eval('[role="status"]', (el) => el.textContent)).toContain('已保存');
      await clickText('100%', '.system-preview-zoom button');
      expect(await page.$('.system-preview-stage.is-actual-size')).toBeTruthy();
      await clickText('适应画布', '.system-preview-zoom button');
      await page.click('.system-spec > summary');
      await page.waitForSelector('.system-spec-document');
      expect(await page.$eval('.system-spec-document', (el) => el.textContent)).toContain(
        'fontWeight',
      );
      await clickText('原文', '.system-spec button');
      expect(await page.$eval('.system-spec pre', (el) => el.textContent)).toContain('---');
      await page.click('.system-spec > summary');
      await clickText('返回设计系统');
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await clickText('新建设计系统');
    const dialog = await page.$eval('dialog[open]', (el) => {
      const rect = el.getBoundingClientRect();
      return { middleX: rect.x + rect.width / 2, middleY: rect.y + rect.height / 2 };
    });
    expect(Math.abs(dialog.middleX - 720)).toBeLessThan(2);
    expect(Math.abs(dialog.middleY - 500)).toBeLessThan(2);
    await page.keyboard.press('Escape');
  }, 60000);
  it('refits after an interaction adds content below the fixed-height runtime root', async () => {
    await page.click('.system-card');
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('.system-preview-stage iframe')
            ?.getAttribute('data-measured-height'),
        ) > 0,
    );
    const initial = await page.$eval('.system-preview-stage iframe', (el) =>
      Number(el.getAttribute('data-measured-height')),
    );
    const frame = await (await page.$('.system-preview-stage iframe'))?.contentFrame();
    if (!frame) throw new Error('Missing sample frame');
    await frame.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) throw new Error('Missing root');
      const content = root.querySelector('.ds-inner') ?? root;
      const button = document.createElement('button');
      button.id = 'expand-examples';
      button.textContent = 'Expand examples';
      let expanded: HTMLElement | null = null;
      button.onclick = () => {
        if (expanded) {
          expanded.remove();
          expanded = null;
          return;
        }
        const section = document.createElement('section');
        section.style.height = '1600px';
        section.textContent = 'Additional component examples';
        content.append(section);
        expanded = section;
      };
      content.prepend(button);
      button.click();
    });
    await page.waitForFunction(
      (before) =>
        Number(
          document
            .querySelector('.system-preview-stage iframe')
            ?.getAttribute('data-measured-height'),
        ) >
        before + 1000,
      { timeout: 5000 },
      initial,
    );
    const fitted = await page.evaluate(() => {
      const canvas = document.querySelector('.system-preview-stage')?.getBoundingClientRect();
      const iframe = document
        .querySelector('.system-preview-stage iframe')
        ?.getBoundingClientRect();
      return canvas && iframe ? iframe.bottom <= canvas.bottom + 1 : false;
    });
    expect(fitted).toBe(true);
    await frame.$eval('#expand-examples', (el) => (el as HTMLButtonElement).click());
    await page.waitForFunction(
      (before) =>
        Number(
          document
            .querySelector('.system-preview-stage iframe')
            ?.getAttribute('data-measured-height'),
        ) <=
        before + 40,
      { timeout: 5000 },
      initial,
    );
  }, 30000);
  it('preselects from system details, copies the spec, and clears selection for the next design', async () => {
    await page.click('.system-card');
    await page.waitForSelector('.system-detail iframe');
    const iframe = await page.$('.system-detail iframe');
    const frame = await iframe?.contentFrame();
    if (!frame) throw new Error('Missing sample frame');
    await frame.waitForSelector('h1');
    await page.evaluate(() => {
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'ELEMENT_SELECTED')
          Reflect.set(window, 'systemSelection', event.data);
      });
      document
        .querySelector('iframe')
        ?.contentWindow?.postMessage({ __codesign: true, type: 'SET_MODE', mode: 'comment' }, '*');
    });
    await frame.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await frame.click('h1');
    await page.waitForFunction(() => Boolean(Reflect.get(window, 'systemSelection')));
    const selection = await page.evaluate(
      () => Reflect.get(window, 'systemSelection') as { outerHTML: string },
    );
    expect(selection.outerHTML).toContain('<!-- DESIGN.md: typography.display -->');
    await clickText('使用此系统');
    await page.waitForSelector('[aria-label="新建设计"]');
    expect(
      await page.$eval('[aria-label="新建设计"] select', (el) => (el as HTMLSelectElement).value),
    ).toBe('builtin:ibm');
    await clickText('创建', '[role="dialog"] button');
    await page.waitForSelector('[aria-label="Editor"]', { timeout: 25000 }).catch(async () => {
      throw new Error(
        JSON.stringify({
          errors,
          text: await page.$eval('body', (el) => el.innerText),
          designs: listDesigns(db),
        }),
      );
    });
    const design = listDesigns(db).find((d) => !d.designSystemId);
    expect(design?.workspacePath).toBeTruthy();
    expect(await readFile(path.join(design?.workspacePath ?? '', 'DESIGN.md'), 'utf8')).toBe(
      (await library.get('builtin:ibm')).designMd,
    );
    await clickText('返回库');
    await clickText('新建设计');
    expect(
      await page.$eval('[aria-label="新建设计"] select', (el) => (el as HTMLSelectElement).value),
    ).toBe('');
    await page.keyboard.press('Escape');
  }, 90000);
  it('forks into a resumable editor and keeps that session out of ordinary recent designs', async () => {
    await page.click('.system-card');
    await page.waitForSelector('.system-detail');
    await clickText('基于此创建');
    await page.waitForSelector('[aria-label="Editor"]');
    const personal = (await library.list()).find((s) => !s.builtin);
    expect(personal?.sessionDesignId).toBeTruthy();
    const editor = getDesign(db, personal?.sessionDesignId ?? '');
    expect(editor?.designSystemId).toBe(personal?.id);
    expect(listSnapshots(db, editor?.id ?? '')).toHaveLength(1);
    await clickText('返回设计系统');
    await page.waitForFunction(() => document.querySelectorAll('.system-card').length === 4);
    const evidence = path.resolve('../../docs/validation/design-systems');
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'library-ui.png') });
    expect(errors).toEqual([]);
  }, 60000);
});
