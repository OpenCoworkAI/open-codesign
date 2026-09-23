import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import { SourceEditApplyResultV1, SourceEditInspectResultV1 } from '@open-codesign/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { build, type PreviewServer, preview } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from '../../../main/snapshots-db';
import {
  registerSourceEditBusyCheck,
  registerSourceEditsIpc,
} from '../../../main/source-edits-ipc';
import type { CodesignApi } from '../../../preload';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('../../../main/electron-runtime', () => ({
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
}));
vi.mock('../../../main/logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

const original = `function App(){const [count,setCount]=React.useState(0);return <main><h1 title="Original title">Original heading</h1><button onClick={()=>setCount(c=>c+1)}>Count {count}</button><section aria-label="Cards" style={{display:'flex',gap:12}}><span>A</span><span>B</span></section><div>{[1,2].map(n=><p key={n}>Repeated {n}</p>)}</div></main>}`;
const evidence = resolve(
  process.cwd(),
  '../../.Codex/workspace/validation/source-edit-browser',
  `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const fixture = 'src/renderer/src/components/__fixtures__/source-edit-browser.html';

// Real Chromium, full FilesTabView and production IPC handlers/engine/atomic writer.
// HTTP replaces Electron transport only. No LLM or real user workspace is used.
describe('full FilesTab source edit browser + real IPC handlers over HTTP', () => {
  let browser: Browser;
  let server: PreviewServer;
  let page: Page;
  let directory: string;
  let workspace: string;
  let endpoint: string;
  let unregister: (() => void) | undefined;
  let db: ReturnType<typeof initInMemoryDb>;
  let errors: string[] = [];
  const records: { method: string; result: unknown }[] = [];
  const verified: string[] = [];
  const cases: {
    name: string;
    records: typeof records;
    errors: string[];
    disk: string;
    commits: number;
    applyRequests: number;
  }[] = [];
  const active = new Set<Promise<void>>();
  const disk = () => readFile(join(workspace, 'App.jsx'), 'utf8');

  beforeAll(async () => {
    const chrome = process.env['SOURCE_EDIT_BROWSER_EXECUTABLE'] ?? (await findSystemChrome());
    if (!chrome) throw new Error('System browser required; set SOURCE_EDIT_BROWSER_EXECUTABLE');
    directory = await mkdtemp(join(tmpdir(), 'codesign-source-edit-browser-'));
    workspace = join(directory, 'workspace');
    await mkdir(workspace);
    await mkdir(evidence, { recursive: true });
    await writeFile(join(workspace, 'App.jsx'), original);
    db = initInMemoryDb();
    const design = createDesign(db, 'Source edit browser integration');
    updateDesignWorkspace(db, design.id, workspace);
    unregister = registerSourceEditBusyCheck(() => false);
    registerSourceEditsIpc(db, () => null);
    const outDir = join(directory, 'site');
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
          name: 'source-edit-real-ipc-bridge',
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
              const task = (async () => {
                try {
                  let body = '';
                  for await (const chunk of req) body += String(chunk);
                  const args: unknown[] = JSON.parse(body);
                  let result: unknown;
                  if (method === 'design') result = { ...design, workspacePath: workspace };
                  else if (method === 'read' || method === 'listDir') {
                    if (args[0] !== design.id) throw new Error('Wrong fixture design');
                    const content = await disk();
                    const info = await stat(join(workspace, 'App.jsx'));
                    const entry = {
                      path: 'App.jsx',
                      name: 'App.jsx',
                      type: 'file',
                      kind: 'jsx',
                      size: info.size,
                      updatedAt: info.mtime.toISOString(),
                    } satisfies Awaited<ReturnType<CodesignApi['files']['listDir']>>[number];
                    const file = { ...entry, content } satisfies Awaited<
                      ReturnType<CodesignApi['files']['read']>
                    >;
                    result = method === 'read' ? file : [entry];
                  } else if (method === 'inspect' || method === 'apply') {
                    const handler = handlers.get(`codesign:source-edits:v1:${method}`);
                    if (!handler) throw new Error('Missing production handler');
                    const raw = await handler(null, args[0]);
                    result =
                      method === 'inspect'
                        ? SourceEditInspectResultV1.parse(raw)
                        : SourceEditApplyResultV1.parse(raw);
                    records.push({ method, result });
                  } else throw new Error(`Unknown fixture bridge method: ${method}`);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(result));
                } catch (error) {
                  res.statusCode = 500;
                  res.end(String(error));
                }
              })();
              active.add(task);
              void task.finally(() => active.delete(task));
            });
          },
        },
      ],
    });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No preview server');
    endpoint = `http://127.0.0.1:${address.port}/${fixture}`;
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: join(directory, 'profile'),
    });
  }, 120_000);

  beforeEach(async () => {
    await writeFile(join(workspace, 'App.jsx'), original);
    records.length = 0;
    errors = [];
    page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith(new URL(endpoint).origin) || /^(data:|blob:|about:)/.test(url))
        void request.continue();
      else {
        errors.push(`Unexpected network: ${url}`);
        void request.abort();
      }
    });
    await page.goto(endpoint);
    await page.waitForSelector('iframe');
    const frame = await artifact();
    await frame.waitForSelector('h1');
  }, 60_000);

  afterEach(async (context) => {
    await Promise.allSettled(active);
    if (page && !page.isClosed()) {
      await page.screenshot({
        path: join(evidence, `${context.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100)}.png`),
        fullPage: true,
      });
      await writeFile(
        join(evidence, `${context.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100)}.txt`),
        await page.evaluate(() => document.body.innerText),
      );
      await page.close();
    }
    cases.push({
      name: context.task.name,
      records: [...records],
      errors: [...errors],
      disk: await disk(),
      applyRequests: records.filter((record) => record.method === 'apply').length,
      commits: records.filter(
        (record) =>
          record.method === 'apply' &&
          SourceEditApplyResultV1.parse(record.result).status === 'applied',
      ).length,
    });
    await writeFile(
      join(evidence, 'verification.json'),
      JSON.stringify(
        {
          levels: {
            browser: 'system Chromium',
            fullFilesTab: true,
            transport: 'HTTP invokes captured production IPC handlers',
            electronE2E: false,
            realEngine: true,
            realAtomicWriter: true,
            temporaryWorkspace: true,
            llm: false,
            screenshotReview: 'PNG captured; visual review unavailable (model has no image input)',
            uiChecks:
              'DOM visibility, viewport bounds, label association, keyboard entry, actual button clicks',
          },
          verified,
          cases,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  });
  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      await Promise.allSettled(active);
      if (server)
        await new Promise<void>((done, fail) =>
          server.httpServer.close((error) => (error ? fail(error) : done())),
        );
      unregister?.();
      if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  async function artifact(selector = 'h1') {
    return page.waitForFrame(async (frame) => {
      if (!frame.parentFrame()) return false;
      try {
        return Boolean(await frame.$(selector));
      } catch {
        return false;
      }
    });
  }
  async function assertPanelLayout() {
    const issues = await page.evaluate(() => {
      const panel = document.querySelector('aside[aria-busy]');
      if (!panel) return ['Source edit panel missing'];
      const issues: string[] = [];
      for (const node of [panel, ...panel.querySelectorAll('textarea, button')]) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          style.visibility === 'hidden' ||
          style.display === 'none'
        )
          issues.push(`Invisible ${node.tagName}`);
        if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight)
          issues.push(`Outside viewport: ${node.tagName}`);
      }
      for (const input of panel.querySelectorAll('textarea')) {
        if (!input.labels?.length || !input.labels[0]?.textContent?.trim())
          issues.push('Unlabelled textarea');
        if (input.disabled) issues.push('Disabled textarea');
      }
      for (const button of panel.querySelectorAll('button')) {
        if (!button.getAttribute('aria-label')) issues.push('Unlabelled button');
        if (button.disabled) issues.push('Disabled button');
      }
      return issues;
    });
    expect(issues).toEqual([]);
  }
  async function enterEdit() {
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() => document.body.innerText.includes('Local source edit'));
    await artifact('[data-codesign-source-id]');
    await assertPanelLayout();
  }
  async function save(label: string, value: string) {
    const selector = `[aria-label="Save source definition: ${label}"]`;
    const button = await page.waitForSelector(selector);
    if (!button) throw new Error('Missing save control');
    await assertPanelLayout();
    await page.screenshot({ path: join(evidence, `edit-${label}.png`), fullPage: true });
    const input = await button.evaluateHandle((node) =>
      node.closest('form')?.querySelector('textarea'),
    );
    const element = input.asElement();
    if (!element) throw new Error('Missing edit textarea');
    await element.evaluate((node) => {
      if (node instanceof HTMLTextAreaElement) node.focus();
    });
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.type(value);
    await page.click(selector);
  }
  it.each([
    [
      'title',
      'h1',
      'Updated title',
      original.replace('title="Original title"', 'title={"Updated title"}'),
    ],
    ['gap', 'section', '24', original.replace('gap:12', 'gap:24')],
  ])(
    'persists existing %s with an exact single diff and working reloaded counter',
    async (label, selector, value, expected) => {
      await enterEdit();
      await (await artifact('[data-codesign-source-id]')).click(selector);
      await save(label, value);
      await expect.poll(disk).toBe(expected);
      await page.waitForFunction(() =>
        document.body.innerText.toLowerCase().includes('reset its state'),
      );
      await page.reload();
      const frame = await artifact();
      if (label === 'title')
        expect(await frame.$eval('h1', (node) => node.getAttribute('title'))).toBe(value);
      else expect(await frame.$eval('section', (node) => getComputedStyle(node).gap)).toBe('24px');
      await frame.click('button');
      expect(await frame.$eval('button', (node) => node.textContent)).toBe('Count 1');
      verified.push(
        `${label}: exact single disk replacement, visible reset-state warning, DOM reload and working counter`,
      );
    },
    60_000,
  );

  it('rejects dynamic and repeated selections without offering writes', async () => {
    await enterEdit();
    const frame = await artifact('[data-codesign-source-id]');
    await frame.click('button');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('non-static-text'),
    );
    expect(await page.$$('aside[aria-busy] form')).toHaveLength(0);
    const repeatedMarkers = await frame.$$eval('p', (nodes) =>
      nodes.map((node) => node.getAttribute('data-codesign-source-id')),
    );
    expect(repeatedMarkers).toHaveLength(2);
    expect(repeatedMarkers[0]).toBeTruthy();
    expect(repeatedMarkers[0]).toBe(repeatedMarkers[1]);
    await frame.click('p');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('non-direct-source'),
    );
    expect(await page.$$('aside[aria-busy] form')).toHaveLength(0);
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(original);
    verified.push(
      'dynamic count and repeated map output: no editable controls, no apply request, unchanged disk',
    );
  }, 60_000);

  it('rejects stale disk changes without overwriting external content', async () => {
    await enterEdit();
    await (await artifact('[data-codesign-source-id]')).click('h1');
    await page.waitForSelector('[aria-label="Save source definition: Text"]');
    const external = original.replace('Original heading', 'External edit wins');
    await writeFile(join(workspace, 'App.jsx'), external);
    await save('Text', 'Must not overwrite');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('stale-source'),
    );
    expect(await disk()).toBe(external);
    expect(
      records.filter((record) => record.method === 'apply').map((record) => record.result),
    ).toEqual([expect.objectContaining({ status: 'rejected', reason: 'stale-source' })]);
    verified.push(
      'external disk conflict: production IPC stale-source rejection and external bytes preserved',
    );
  }, 60_000);

  it('ignores an old revision overlay payload from the current iframe window', async () => {
    await enterEdit();
    const oldFrame = await artifact('[data-codesign-source-id]');
    const oldMarker = await oldFrame.$eval('section', (node) =>
      node.getAttribute('data-codesign-source-id'),
    );
    if (!oldMarker) throw new Error('Missing old source marker');
    const [oldRevision, ...targetParts] = oldMarker.split(':');
    const inspected = records.find((record) => record.method === 'inspect');
    const result = SourceEditInspectResultV1.parse(inspected?.result);
    if (result.status !== 'ready') throw new Error('Expected ready inspection');
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() => !document.body.innerText.includes('Local source edit'));
    await enterEdit();
    const frame = await artifact('[data-codesign-source-id]');
    const marker = await frame.$eval('section', (node) =>
      node.getAttribute('data-codesign-source-id'),
    );
    expect(marker).not.toBe(oldMarker);
    await frame.click('h1');
    await page.waitForSelector('[aria-label="Save source definition: title"]');
    await page.evaluate((revision) => {
      Reflect.set(window, 'observedOldSourceRevision', false);
      window.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.sourceEdit?.previewRevision === revision)
          Reflect.set(window, 'observedOldSourceRevision', true);
      });
    }, oldRevision);
    await frame.evaluate(
      (meta) => {
        parent.postMessage(
          {
            __codesign: true,
            type: 'ELEMENT_SELECTED',
            selector: '/main[1]/section[1]',
            tag: 'section',
            outerHTML: '<section>Old selection</section>',
            rect: { top: 0, left: 0, width: 20, height: 20 },
            sourceEdit: meta,
          },
          '*',
        );
      },
      {
        targetId: targetParts.join(':'),
        sourceHash: result.sourceHash,
        previewRevision: oldRevision,
      },
    );
    await page.waitForFunction(() => Reflect.get(window, 'observedOldSourceRevision') === true);
    expect(await page.$('[aria-label="Save source definition: title"]')).not.toBeNull();
    expect(await page.$('[aria-label="Save source definition: gap"]')).toBeNull();
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(original);
    verified.push(
      'old revision ELEMENT_SELECTED from current iframe observed but did not change current h1 selection or disk',
    );
  }, 60_000);
  it('persists an exact text patch through the full FilesTab UI', async () => {
    await (await artifact()).click('button');
    expect(await (await artifact()).$eval('button', (node) => node.textContent)).toBe('Count 1');
    await enterEdit();
    await (await artifact()).click('h1');
    await save('Text', 'Edited heading');
    await expect.poll(disk).toBe(original.replace('Original heading', '{"Edited heading"}'));
    verified.push('text exact single replacement via UI -> HTTP -> real IPC -> atomic disk write');
    await page.reload();
    await page.waitForSelector('iframe');
    await (await artifact()).waitForFunction(
      () => document.querySelector('h1')?.textContent === 'Edited heading',
    );
    await (await artifact()).click('button');
    expect(await (await artifact()).$eval('button', (node) => node.textContent)).toBe('Count 1');
    verified.push('reloaded persisted artifact retains counter business behavior');
  }, 60_000);
});
