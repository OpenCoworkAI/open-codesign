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
import { getSourceEntry, initializeSourceEntry } from '../../../main/source-entry';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('../../../main/electron-runtime', () => ({
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
}));
vi.mock('../../../main/logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
const original =
  '<!doctype html>\n<html><head><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px}section{display:flex;gap:4px}</style></head><body onload="document.body.dataset.loaded=\'yes\'"><main><h1 title="Old title" style="color: red">原始标题 😀</h1><button id="counter">Count 0</button><section title="Cards" style="display:flex;gap:4px"><span>One</span><span>Two</span></section><img alt="Original image" /><input placeholder="Original placeholder" /></main><script>document.getElementById("counter").onclick=()=>{const b=document.getElementById("counter");b.textContent="Count "+(Number(b.textContent.split(" ")[1])+1);};const p=document.createElement("p");p.id="dynamic";p.textContent="Script-generated";document.body.append(p);</script></body></html>';
const fixture = 'src/renderer/src/components/__fixtures__/source-edit-browser.html';
const evidence = resolve(
  process.cwd(),
  '../../.Codex/workspace/validation/html-source-edit',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

describe('native HTML point edit: FilesTab → real IPC → atomic disk write → reload', () => {
  let browser: Browser, page: Page, server: PreviewServer;
  let directory: string, workspace: string, endpoint: string;
  let unregister: (() => void) | undefined;
  const active = new Set<Promise<void>>();
  let errors: string[] = [];
  let inspectGate: Promise<void> | null = null;
  const records: { method: string; result: unknown }[] = [];
  const disk = () => readFile(join(workspace, 'index.html'), 'utf8');
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'codesign-html-edit-'));
    workspace = join(directory, 'workspace');
    await mkdir(workspace);
    await mkdir(evidence, { recursive: true });
    await writeFile(join(workspace, 'index.html'), original);
    const db = { ...initInMemoryDb(), sessionDir: join(directory, 'sessions') };
    const design = createDesign(db, 'Native HTML source edit');
    updateDesignWorkspace(db, design.id, workspace);
    await initializeSourceEntry(db, design.id);
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
          name: 'native-html-real-ipc',
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
                  else if (args[0] !== design.id && method !== 'inspect' && method !== 'apply')
                    throw new Error('Wrong design');
                  else if (method === 'sourceEntry') result = await getSourceEntry(db, design.id);
                  else if (method === 'read' || method === 'listDir') {
                    const info = await stat(join(workspace, 'index.html'));
                    const entry = {
                      path: 'index.html',
                      name: 'index.html',
                      type: 'file',
                      kind: 'html',
                      size: info.size,
                      updatedAt: info.mtime.toISOString(),
                    };
                    result = method === 'read' ? { ...entry, content: await disk() } : [entry];
                  } else if (method === 'inspect' || method === 'apply') {
                    if (method === 'inspect' && inspectGate) await inspectGate;
                    const handler = handlers.get(`codesign:source-edits:v1:${method}`);
                    if (!handler) throw new Error('Missing production IPC');
                    const reply = await handler(null, args[0]);
                    result =
                      method === 'inspect'
                        ? SourceEditInspectResultV1.parse(reply)
                        : SourceEditApplyResultV1.parse(reply);
                    records.push({ method, result });
                  } else throw new Error(`Unknown method ${method}`);
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
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    endpoint = `http://127.0.0.1:${address.port}/${fixture}?native=1`;
    browser = await puppeteer.launch({
      executablePath: await findSystemChrome(),
      headless: true,
      userDataDir: join(directory, 'profile'),
    });
  }, 120_000);
  beforeEach(async () => {
    inspectGate = null;
    await writeFile(join(workspace, 'index.html'), original);
    records.length = 0;
    errors = [];
    page = await browser.newPage();
    await page.setViewport({ width: 1550, height: 1100 });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        request.url().startsWith(new URL(endpoint).origin) ||
        /^(data:|blob:|about:)/.test(request.url())
      )
        void request.continue();
      else {
        errors.push(`Unexpected request: ${request.url()}`);
        void request.abort();
      }
    });
    await page.goto(endpoint);
    await artifact('#counter');
  }, 30_000);
  afterEach(async (context) => {
    await Promise.allSettled(active);
    const filename = context.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 110);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(evidence, `${filename}.png`), fullPage: true });
      await page.close();
    }
    await writeFile(
      join(evidence, `${filename}.json`),
      JSON.stringify(
        {
          errors,
          records,
          source: await disk(),
          electronTransport: false,
          realIpcEngineAndAtomicWriter: true,
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
  async function artifact(selector: string) {
    return page.waitForFrame(async (frame) => {
      if (!frame.parentFrame()) return false;
      try {
        return Boolean(await frame.$(selector));
      } catch {
        return false;
      }
    });
  }
  async function edit(selector: string) {
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() =>
      document.body.innerText.includes('HTML editing temporarily pauses'),
    );
    const frame = await artifact(`${selector}[data-codesign-source-id]`);
    expect(await frame.$('#dynamic')).toBeNull();
    expect(await frame.$eval('body', (node) => node.getAttribute('data-loaded'))).toBeNull();
    await frame.click(selector);
    return frame;
  }
  async function save(label: string, value: string) {
    const selector = `[aria-label="Save source definition: ${label}"]`;
    const button = await page.waitForSelector(selector);
    if (!button) throw new Error('Missing save button');
    const input = (
      await button.evaluateHandle((node) => node.closest('form')?.querySelector('textarea'))
    ).asElement();
    if (!input) throw new Error('Missing field');
    await page.screenshot({ path: join(evidence, `editor-${label}.png`), fullPage: true });
    await input.evaluate((node) => {
      if (node instanceof HTMLTextAreaElement) node.focus();
    });
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.type(value);
    await page.click(selector);
  }
  it.each([
    ['Text', 'h1', '新标题 & 字符', original.replace('原始标题 😀', '新标题 &amp; 字符')],
    ['title', 'h1', 'New title', original.replace('title="Old title"', 'title="New title"')],
    ['color', 'h1', '#123456', original.replace('color: red', 'color: #123456')],
    ['gap', 'section', '24', original.replace('gap:4px"', 'gap:24px"')],
  ])(
    'selects HTML and saves %s as a minimal source patch, then restores authored interaction',
    async (label, selector, value, expected) => {
      await edit(selector);
      await save(label, value);
      await expect.poll(disk).toBe(expected);
      expect(await disk()).not.toContain('data-codesign-source-id');
      expect(await disk()).not.toContain('data-codesign-source-edit-policy');
      await page.reload();
      const frame = await artifact('#counter');
      if (label === 'Text') expect(await frame.$eval('h1', (node) => node.textContent)).toBe(value);
      if (label === 'title')
        expect(await frame.$eval('h1', (node) => node.getAttribute('title'))).toBe(value);
      if (label === 'color')
        expect(await frame.$eval('h1', (node) => getComputedStyle(node).color)).toBe(
          'rgb(18, 52, 86)',
        );
      if (label === 'gap')
        expect(await frame.$eval('section', (node) => getComputedStyle(node).gap)).toBe('24px');
      await frame.click('#counter');
      await frame.waitForFunction(
        () => document.getElementById('counter')?.textContent === 'Count 1',
      );
      expect(await frame.$('#dynamic')).not.toBeNull();
      expect(records.filter((record) => record.method === 'apply')).toHaveLength(1);
    },
    60_000,
  );
  it('adds a previously absent inline style through the actual HTML side panel', async () => {
    await edit('h1');
    await save('fontSize', '20');
    await expect
      .poll(disk)
      .toBe(original.replace('style="color: red"', 'style="color: red; font-size: 20px;"'));
    await page.reload();
    const frame = await artifact('h1');
    expect(await frame.$eval('h1', (node) => getComputedStyle(node).fontSize)).toBe('20px');
  }, 60_000);
  it('does not execute authored scripts while waiting for the initial source inspection', async () => {
    let resume = () => {};
    inspectGate = new Promise<void>((done) => {
      resume = done;
    });
    try {
      await page.click('button::-p-text(Edit source)');
      const pending = await artifact('body[data-codesign-edit-pending]');
      expect(await pending.$('script')).toBeNull();
      expect(await pending.$('#dynamic')).toBeNull();
    } finally {
      resume();
      inspectGate = null;
    }
    await artifact('h1[data-codesign-source-id]');
  }, 60_000);
  it('re-inspects between consecutive edits and resumes scripts when editing is toggled off', async () => {
    await edit('h1');
    await save('Text', 'First change');
    const first = original.replace('原始标题 😀', 'First change');
    await expect.poll(disk).toBe(first);
    const editing = await artifact('h1[data-codesign-source-id]');
    await editing.click('h1');
    await save('title', 'Second change');
    await expect.poll(disk).toBe(first.replace('title="Old title"', 'title="Second change"'));
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() => !document.body.innerText.includes('Local source edit'));
    const normal = await artifact('#dynamic');
    await normal.click('#counter');
    await normal.waitForFunction(
      () => document.getElementById('counter')?.textContent === 'Count 1',
    );
    expect(await normal.$eval('h1', (node) => node.textContent)).toBe('First change');
    expect(await normal.$('[data-codesign-source-id]')).toBeNull();
  }, 60_000);
  it('refuses a stale HTML edit without overwriting external disk changes', async () => {
    await edit('h1');
    const external = original.replace('原始标题 😀', 'Externally edited');
    await writeFile(join(workspace, 'index.html'), external);
    await save('Text', 'Must not overwrite');
    await page.waitForFunction(() => document.body.innerText.includes('stale-source'));
    expect(await disk()).toBe(external);
    expect(
      records.filter((record) => record.method === 'apply').map((record) => record.result),
    ).toEqual([expect.objectContaining({ status: 'rejected', reason: 'stale-source' })]);
  }, 60_000);
});
