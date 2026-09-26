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
const resumeFixture = `const resume = { name: 'Alex', city: 'City' };
const role = 'Engineer';
const labels = ['Available', 'City'];
function Badge(){return <p className="helper" title="Helper title"><span aria-hidden="true">★</span>Team <strong>design</strong>{'ready'}</p>}
function PropLabel({label}){return <p className="prop-label">{label}</p>}
function App(){
  React.useEffect(()=>{document.documentElement.dataset.fixture='mounted'},[]);
  return <main>
    <h1 title="Resume title">{resume.name}</h1>
    <p id="city">{resume.city}</p><p id="role">{role}</p><p id="availability">{labels[0]}</p>
    <footer>{resume.name}</footer><p id="independent-name">Alex</p>
    <Badge/><Badge/><p id="independent-helper">Team ready</p>
    <div>{['one','two'].map(key=><p className="static-map" key={key}>Shared map</p>)}</div>
    <p id="independent-map">Shared map</p>
    <div>{[{name:'Map Alex'},{name:'Map Casey'}].map(person=><p className="dynamic-map" key={person.name}>{person.name}</p>)}</div>
    <PropLabel label="Prop Alex"/><p id="computed">{String(7)}</p>
  </main>
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`;
const previewOnlyFixture = `function App(){
  const [count,setCount]=React.useState(0);
  return <main><h1>Preview only</h1>
    <button id="cart" onClick={()=>setCount(c=>c+1)}><svg id="cart-icon" width="20" height="20" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" /></svg>Cart ({count})</button>
    <button id="disabled" disabled title="Disabled action">Unavailable</button>
    <p id="independent">Left <strong>anchor</strong>Right</p>
    <p id="ambiguous">{String('same')}{'same'}{String('same')}</p>
    <p id="between" title="Stable title">Stable text</p>
    <p id="removed-duplicate">{'same'}{'same'}</p>
    <p id="remaining-substring">{String('prefix same')}{'same'}</p>
  </main>;
}`;
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
    await openPage();
  }, 60_000);

  async function openPage() {
    page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    await page.evaluateOnNewDocument(() => {
      Reflect.set(window, 'sourceEditValidationReplies', []);
      window.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.__codesign === true && event.data?.type === 'SOURCE_EDIT_VALIDATED') {
          const replies = Reflect.get(window, 'sourceEditValidationReplies') as unknown[];
          replies.push(event.data.sourceEdit);
        }
      });
    });
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
  }

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
        // The panel may scroll to reveal later per-field controls; its shell must fit.
        if (
          node === panel &&
          (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight)
        )
          issues.push(`Outside viewport: ${node.tagName}`);
      }
      for (const input of panel.querySelectorAll('textarea')) {
        if (!input.labels?.length || !input.labels[0]?.textContent?.trim())
          issues.push('Unlabelled textarea');
        if (input.disabled && !input.getAttribute('aria-describedby'))
          issues.push('Disabled textarea without an explanation');
      }
      for (const button of panel.querySelectorAll('button')) {
        if (!button.getAttribute('aria-label')) issues.push('Unlabelled button');
        if (
          button.disabled &&
          !button.closest('form')?.querySelector('textarea[disabled][aria-describedby]')
        )
          issues.push('Disabled button without a refused-field explanation');
      }
      return issues;
    });
    expect(issues).toEqual([]);
  }
  it('shows editability and source explanations in Chinese without changing source', async () => {
    await page.goto(`${endpoint}?locale=zh-CN`);
    await page.waitForSelector('iframe');
    await (await artifact()).waitForSelector('h1');
    await page.click('button::-p-text(编辑源码)');
    await page.waitForSelector('aside[aria-busy="false"]');
    await (await artifact('[data-codesign-source-id]')).click('button');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('循环／组件参数'),
    );
    const primary = await page.$eval('aside[aria-busy]', (node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('details').forEach((detail) => detail.remove());
      return clone.textContent ?? '';
    });
    expect(primary).toContain('暂时无法确定要修改的源码位置');
    expect(primary).toContain('没有可修改的静态属性');
    expect(primary).toContain('此元素没有直接声明的内联样式');
    expect(primary).toContain('文字来源');
    expect(primary).not.toContain('This text');
    expect(primary).not.toContain('string literal');
    expect(primary).not.toContain('unresolved-text-source');
    expect(
      await page.$$eval('aside details', (nodes) =>
        nodes.every((node) => !node.hasAttribute('open')),
      ),
    ).toBe(true);
    expect(await disk()).toBe(original);
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    verified.push(
      'Chinese primary editability/source explanations, collapsed diagnostic codes, original code preserved',
    );
  }, 60_000);

  async function enterEdit() {
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() => document.body.innerText.includes('Local source edit'));
    await artifact('[data-codesign-source-id]');
    await page.waitForSelector('aside[aria-busy="false"]');
    expect(await page.$('button[aria-label="Choose a static source field"]')).toBeNull();
    expect(await page.$('aside select')).toBeNull();
    await assertPanelLayout();
  }
  async function save(label: string, value: string) {
    const selector = `[aria-label="Save source definition: ${label}"]`;
    const button = await page.waitForSelector(selector);
    if (!button) throw new Error('Missing save control');
    await assertPanelLayout();
    await page.screenshot({
      path: join(evidence, `edit-${label.replace(/[^a-z0-9]+/gi, '-')}.png`),
      fullPage: true,
    });
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
  async function loadPreviewOnlyFixture() {
    await writeFile(join(workspace, 'App.jsx'), previewOnlyFixture);
    await page.reload();
    await assertPreviewText('h1', 'Preview only');
  }
  async function validationReplies() {
    return page.evaluate(() => Reflect.get(window, 'sourceEditValidationReplies') as unknown[]);
  }
  async function fieldDisabled(value: string) {
    const label = await textLabel(value);
    return page.$eval(
      `[aria-label="Save source definition: ${label}"]`,
      (node) => node instanceof HTMLButtonElement && node.disabled,
    );
  }
  async function loadResumeFixture() {
    await writeFile(join(workspace, 'App.jsx'), resumeFixture);
    await page.reload();
    const frame = await artifact();
    await frame.waitForFunction(() => document.documentElement.dataset['fixture'] === 'mounted');
    expect(await frame.$eval('h1', (node) => node.textContent)).toBe('Alex');
  }
  async function selectText(selector: string, value: string) {
    await (await artifact('[data-codesign-source-id]')).click(selector);
    await page.waitForFunction(
      (expected) =>
        Array.from(document.querySelectorAll('aside[aria-busy] textarea')).some(
          (node) => node instanceof HTMLTextAreaElement && node.value === expected,
        ),
      {},
      value,
    );
  }
  async function textLabel(value: string) {
    const labels = await page.$$eval(
      'aside[aria-busy] form',
      (forms, expected) =>
        forms.flatMap((form) => {
          const input = form.querySelector('textarea');
          const label = form.querySelector('label')?.textContent;
          return input?.value === expected && label ? [label] : [];
        }),
      value,
    );
    expect(labels).toHaveLength(1);
    const label = labels[0];
    if (!label) throw new Error(`Missing text field for ${value}`);
    return label;
  }
  async function saveText(previous: string, value: string) {
    await save(await textLabel(previous), value);
  }
  async function assertPreviewText(selector: string, value: string) {
    await expect
      .poll(async () =>
        (await artifact(selector)).$$eval(selector, (nodes) =>
          nodes.map((node) => node.textContent),
        ),
      )
      .toEqual([value]);
  }
  function assertExactPatch(
    before: string,
    after: string,
    from: string,
    to: string,
    start = before.indexOf(from),
  ) {
    expect(after).toBe(before.slice(0, start) + to + before.slice(start + from.length));
    const applied = records.filter((record) => record.method === 'apply').at(-1);
    const result = SourceEditApplyResultV1.parse(applied?.result);
    if (result.status !== 'applied') throw new Error('Expected atomic writer acknowledgment');
    expect(result.content).toBe(after);
    expect(result.patch).toEqual({
      start,
      end: start + from.length,
      expectedText: from,
      replacement: to,
    });
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

  it('rejects dynamic-only and repeated parameter selections without offering writes', async () => {
    const dynamicOnly = original.replace('Count {count}', '{count}').replace('Repeated {n}', '{n}');
    await writeFile(join(workspace, 'App.jsx'), dynamicOnly);
    await page.reload();
    await artifact();
    await enterEdit();
    const frame = await artifact('[data-codesign-source-id]');
    await frame.click('button');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('unresolved-text-source'),
    );
    expect(await page.$$('aside[aria-busy] form')).toHaveLength(0);
    const repeatedMarkers = await frame.$$eval('p', (nodes) =>
      nodes.map((node) => node.getAttribute('data-codesign-source-id')),
    );
    expect(repeatedMarkers).toHaveLength(2);
    expect(repeatedMarkers[0]).toBeTruthy();
    expect(repeatedMarkers[0]).toBe(repeatedMarkers[1]);
    await frame.click('p');
    await page.waitForFunction(() => {
      const text = document.querySelector('aside[aria-busy]')?.textContent;
      return text?.includes('<p>') && text.includes('unresolved-text-source');
    });
    expect(await page.$$('aside[aria-busy] form')).toHaveLength(0);
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(dynamicOnly);
    verified.push(
      'dynamic-only count and repeated map parameters: no editable controls, no apply request, unchanged disk',
    );
  }, 60_000);

  it('rejects stale disk changes without overwriting external content', async () => {
    await enterEdit();
    await (await artifact('[data-codesign-source-id]')).click('h1');
    await page.waitForSelector('[aria-label="Save source definition: Text 1"]');
    const external = original.replace('Original heading', 'External edit wins');
    await writeFile(join(workspace, 'App.jsx'), external);
    await save('Text 1', 'Must not overwrite');
    await page.waitForFunction(() =>
      document
        .querySelector('aside[aria-busy]')
        ?.textContent?.includes('The source changed; no edit was written.'),
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
            sourceEditRevision: {
              sourceHash: meta.sourceHash,
              previewRevision: meta.previewRevision,
            },
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
  it('traces a resume object definition across intentional uses, reopening, and a source conflict', async () => {
    await loadResumeFixture();
    await enterEdit();
    await selectText('h1', 'Alex');
    expect(await textLabel('Alex')).toMatch(/^Text \d+$/);
    const panel = await page.$eval('aside[aria-busy]', (node) => node.textContent);
    expect(panel).toContain('resume.name');
    expect(panel).toContain("'Alex'");
    expect(panel).toContain('App.jsx:1');
    expect(await page.$('[aria-label="Save source definition: title"]')).not.toBeNull();
    await saveText('Alex', 'Alex Rivera');
    const expected = resumeFixture.replace("'Alex'", '"Alex Rivera"');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(resumeFixture, await disk(), "'Alex'", '"Alex Rivera"');
    await assertPreviewText('h1', 'Alex Rivera');
    await assertPreviewText('footer', 'Alex Rivera');
    await assertPreviewText('#independent-name', 'Alex');
    await assertPreviewText('#city', 'City');

    await page.reload();
    await assertPreviewText('h1', 'Alex Rivera');
    await page.close();
    await openPage();
    await assertPreviewText('footer', 'Alex Rivera');
    await enterEdit();
    await selectText('h1', 'Alex Rivera');
    const external = expected.replace("city: 'City'", "city: 'External City'");
    await writeFile(join(workspace, 'App.jsx'), external);
    await saveText('Alex Rivera', 'Must not overwrite');
    await page.waitForFunction(() =>
      document
        .querySelector('aside[aria-busy]')
        ?.textContent?.includes('The source changed; no edit was written.'),
    );
    expect(await disk()).toBe(external);
    expect(
      records.filter((record) => record.method === 'apply').map((record) => record.result),
    ).toEqual([
      expect.objectContaining({ status: 'applied' }),
      expect.objectContaining({ status: 'rejected', reason: 'stale-source' }),
    ]);
    verified.push(
      'resume.name: shared literal origin, exact atomic patch, intentional footer reuse, independent same-value literal and city unchanged, refreshed/reloaded/new-page persistence, stale conflict preserves external bytes',
    );
  }, 60_000);

  it.each([
    ['local string', '#role', 'Engineer', 'Designer', "'Engineer'", '"Designer"'],
    [
      'static array index',
      '#availability',
      'Available',
      'Open to work',
      "'Available'",
      '"Open to work"',
    ],
  ])(
    'persists a traced %s despite effects and explicit mount',
    async (_kind, selector, previous, value, from, to) => {
      await loadResumeFixture();
      await enterEdit();
      await selectText(selector, previous);
      expect(await textLabel(previous)).toMatch(/^Text \d+$/);
      await saveText(previous, value);
      await expect.poll(disk).toBe(resumeFixture.replace(from, to));
      assertExactPatch(resumeFixture, await disk(), from, to);
      await assertPreviewText(selector, value);
      await assertPreviewText('h1', 'Alex');
      await assertPreviewText('#city', 'City');
      await page.reload();
      await assertPreviewText(selector, value);
      await enterEdit();
      await selectText(selector, value);
      verified.push(
        `${_kind}: actual source literal only, mount/effect fixture, refreshed preview, reload and reopened panel`,
      );
    },
    60_000,
  );

  it('edits mixed helper segments and a shared map definition without touching same-value siblings', async () => {
    await loadResumeFixture();
    await enterEdit();
    await selectText('.helper', 'Team ');
    const firstLabel = await textLabel('Team ');
    const secondLabel = await textLabel('ready');
    expect(firstLabel).toMatch(/^Text \d+$/);
    expect(secondLabel).toMatch(/^Text \d+$/);
    expect(firstLabel).not.toBe(secondLabel);
    expect(await page.$eval('aside[aria-busy]', (node) => node.textContent)).toContain('every use');
    expect(await page.$('[aria-label="Save source definition: title"]')).toBeNull();
    await save(firstLabel, 'Group ');
    let expected = resumeFixture.replace('Team <strong>', '{"Group "}<strong>');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(resumeFixture, await disk(), 'Team ', '{"Group "}');
    await expect
      .poll(async () =>
        (await artifact()).$$eval('.helper', (nodes) => nodes.map((node) => node.textContent)),
      )
      .toEqual(['★Group designready', '★Group designready']);
    await assertPreviewText('#independent-helper', 'Team ready');
    await selectText('.helper', 'ready');
    await saveText('ready', 'set');
    const beforeSecond = expected;
    expected = expected.replace("{'ready'}", '{"set"}');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(beforeSecond, await disk(), "{'ready'}", '{"set"}');
    await expect
      .poll(async () =>
        (await artifact()).$$eval('.helper', (nodes) => nodes.map((node) => node.textContent)),
      )
      .toEqual(['★Group designset', '★Group designset']);
    expect(
      await (await artifact()).$$eval('.helper strong', (nodes) =>
        nodes.map((node) => node.textContent),
      ),
    ).toEqual(['design', 'design']);
    await selectText('.static-map', 'Shared map');
    await saveText('Shared map', 'Shared definition');
    const beforeMap = expected;
    expected = expected.replace('>Shared map</p>)', '>{"Shared definition"}</p>)');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(beforeMap, await disk(), 'Shared map', '{"Shared definition"}');
    await expect
      .poll(async () =>
        (await artifact()).$$eval('.static-map', (nodes) => nodes.map((node) => node.textContent)),
      )
      .toEqual(['Shared definition', 'Shared definition']);
    await assertPreviewText('#independent-map', 'Shared map');
    await page.reload();
    await expect
      .poll(async () =>
        (await artifact()).$$eval('.helper', (nodes) => nodes.map((node) => node.textContent)),
      )
      .toEqual(['★Group designset', '★Group designset']);
    await enterEdit();
    await selectText('.static-map', 'Shared definition');
    verified.push(
      'mixed helper: distinct segment labels, exact per-segment patches, nested icon/strong untouched, both intentional component/map uses updated, independent same-value siblings untouched, reload and reopened panel',
    );
  }, 60_000);

  it('refuses map parameters, component props, computed text, and exact direct-text mismatches', async () => {
    await loadResumeFixture();
    await enterEdit();
    for (const selector of ['.dynamic-map', '.prop-label', '#computed']) {
      // Start from an editable target so each refusal must replace a real form.
      await selectText('#city', 'City');
      await (await artifact()).click(selector);
      await page.waitForFunction(() =>
        document.querySelector('aside[aria-busy]')?.textContent?.includes('unresolved-text-source'),
      );
      expect(await page.$$('aside[aria-busy] form')).toHaveLength(0);
    }
    await selectText('#city', 'City');
    const frame = await artifact();
    // A whitespace-only runtime mismatch must not be normalized into a source match.
    await frame.$eval('#city', (node) => {
      node.textContent = ' City';
    });
    await frame.click('#city');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('changed from its source'),
    );
    expect(await fieldDisabled('City')).toBe(true);
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(resumeFixture);
    expect(await page.$('button[aria-label="Choose a static source field"]')).toBeNull();
    expect(await page.$('aside select')).toBeNull();
    verified.push(
      'unresolved map parameters/props/computed text: no fields or writes; exact whitespace mismatch disables only that field with an explanation; no source-picker bypass exists',
    );
  }, 60_000);

  it('edits Cart prefix and suffix without activating the artifact, then restores normal interaction', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await selectText('#cart', 'Cart (');
    expect(await textLabel('Cart (')).toBe('Text 1');
    expect(await textLabel(')')).toBe('Text 2');
    expect(await fieldDisabled('Cart (')).toBe(false);
    expect(await fieldDisabled(')')).toBe(false);
    await assertPreviewText('#cart', 'Cart (0)');
    expect(await (await artifact()).$('[data-codesign-edit-hit-layer]')).not.toBeNull();
    await saveText('Cart (', 'Basket (');
    let expected = previewOnlyFixture.replace('Cart (', '{"Basket ("}');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(previewOnlyFixture, await disk(), 'Cart (', '{"Basket ("}');
    await assertPreviewText('#cart', 'Basket (0)');
    await selectText('#cart', ')');
    await saveText(')', ' items)');
    const beforeSuffix = expected;
    expected = expected.replace('{count})</button>', '{count}{" items)"}</button>');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(
      beforeSuffix,
      await disk(),
      ')',
      '{" items)"}',
      beforeSuffix.indexOf('{count})') + '{count}'.length,
    );
    await assertPreviewText('#cart', 'Basket (0 items)');
    expect((await validationReplies()).length).toBeGreaterThanOrEqual(2);
    await page.click('button::-p-text(Edit source)');
    await page.waitForFunction(() => !document.querySelector('aside[aria-busy]'));
    const frame = await artifact('#cart');
    expect(await frame.$('[data-codesign-edit-hit-layer]')).toBeNull();
    await frame.click('#cart');
    await assertPreviewText('#cart', 'Basket (1 items)');
    await page.reload();
    await assertPreviewText('#cart', 'Basket (0 items)');
    await (await artifact()).click('#cart');
    await assertPreviewText('#cart', 'Basket (1 items)');
    await enterEdit();
    await selectText('#cart', 'Basket (');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('aside[aria-busy]'));
    const afterEscape = await artifact('#cart');
    expect(await afterEscape.$('[data-codesign-edit-hit-layer]')).toBeNull();
    await afterEscape.click('#cart');
    await assertPreviewText('#cart', 'Basket (1 items)');
    verified.push(
      'Cart dynamic count: separate static prefix/suffix exact patches, real validation replies, pointer selection does not click artifact, hit layer removed on toggle/Escape and normal counter works after toggle/reload/Escape',
    );
  }, 60_000);

  it('selects a disabled button through the real pointer hit layer and persists its text', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await selectText('#disabled', 'Unavailable');
    expect(
      await (await artifact()).$eval(
        '#disabled',
        (node) => node instanceof HTMLButtonElement && node.disabled,
      ),
    ).toBe(true);
    expect(await fieldDisabled('Unavailable')).toBe(false);
    await saveText('Unavailable', 'Coming soon');
    const expected = previewOnlyFixture.replace('Unavailable', '{"Coming soon"}');
    await expect.poll(disk).toBe(expected);
    assertExactPatch(previewOnlyFixture, await disk(), 'Unavailable', '{"Coming soon"}');
    await assertPreviewText('#disabled', 'Coming soon');
    await page.reload();
    await assertPreviewText('#disabled', 'Coming soon');
    await assertPreviewText('#cart', 'Cart (0)');
    await page.close();
    await openPage();
    await assertPreviewText('#disabled', 'Coming soon');
    verified.push(
      'disabled button: actual pointer hit-layer selection, real IPC atomic write, disabled attribute retained, refresh/reload/new-page persisted text, independent cart unchanged',
    );
  }, 60_000);

  it('selects an icon itself before an explicit containing-button breadcrumb', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await (await artifact()).click('#cart-icon');
    await page.waitForSelector('button[aria-label="Select containing element: button"]');
    expect(await page.$$('aside form')).toHaveLength(0);
    expect(await page.$eval('aside[aria-busy]', (node) => node.textContent)).not.toContain(
      '· <button>',
    );
    await assertPreviewText('#cart', 'Cart (0)');
    await page.click('button[aria-label="Select containing element: button"]');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('aside textarea')).some(
        (node) => node instanceof HTMLTextAreaElement && node.value === 'Cart (',
      ),
    );
    expect(await page.$eval('aside[aria-busy]', (node) => node.textContent)).toContain(
      '· <button>',
    );
    await saveText('Cart (', 'Bag (');
    await expect.poll(disk).toBe(previewOnlyFixture.replace('Cart (', '{"Bag ("}'));
    assertExactPatch(previewOnlyFixture, await disk(), 'Cart (', '{"Bag ("}');
    await assertPreviewText('#cart', 'Bag (0)');
    expect(
      await (await artifact()).$eval('#cart-icon rect', (node) => node.getAttribute('width')),
    ).toBe('16');
    verified.push(
      'icon selection never silently promotes to parent; explicit visible breadcrumb reselects button through real runtime, icon markup unchanged and click handler never invoked',
    );
  }, 60_000);

  it('keeps an independently anchored field editable after a sibling text changes', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await (await artifact()).$eval('#independent', (node) => {
      if (node.firstChild) node.firstChild.textContent = 'Runtime left ';
    });
    await selectText('#independent', 'Right');
    expect(await fieldDisabled('Left ')).toBe(true);
    expect(await fieldDisabled('Right')).toBe(false);
    expect(await page.$eval('aside[aria-busy]', (node) => node.textContent)).toContain(
      'changed from its source',
    );
    await saveText('Right', 'Independent');
    await expect.poll(disk).toBe(previewOnlyFixture.replace('Right', '{"Independent"}'));
    assertExactPatch(previewOnlyFixture, await disk(), 'Right', '{"Independent"}');
    await assertPreviewText('#independent', 'Left anchorIndependent');
    await assertPreviewText('#between', 'Stable text');
    verified.push(
      'per-field states: changed left segment disabled with explanation while native-anchor-separated right segment validates and patches independently',
    );
  }, 60_000);

  it('refuses ambiguous identical text without a source-list bypass', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await selectText('#ambiguous', 'same');
    expect(await fieldDisabled('same')).toBe(true);
    expect(await page.$eval('aside[aria-busy]', (node) => node.textContent)).toContain(
      'more than one possible',
    );
    expect(await page.$('aside select')).toBeNull();
    expect(await page.$('button[aria-label="Choose a static source field"]')).toBeNull();
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(previewOnlyFixture);
    verified.push(
      'identical static/dynamic text ambiguity: disabled explained field, no source picker, no apply request and disk unchanged',
    );
  }, 60_000);

  it('never rebinds a removed static text node to a duplicate or dynamic substring', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    const frame = await artifact();
    for (const selector of ['#removed-duplicate', '#remaining-substring']) {
      await frame.$eval(selector, (node) => {
        if (node.lastChild) node.removeChild(node.lastChild);
      });
      await frame.click(selector);
      const expectedFields = selector === '#removed-duplicate' ? 2 : 1;
      await page.waitForFunction(
        (count) => {
          const inputs = Array.from(document.querySelectorAll('aside textarea'));
          return (
            inputs.length === count &&
            inputs.every((input) => input instanceof HTMLTextAreaElement && input.disabled)
          );
        },
        {},
        expectedFields,
      );
      const saves = await page.$$eval('aside form button', (buttons) =>
        buttons.map((button) => button instanceof HTMLButtonElement && button.disabled),
      );
      expect(saves).toEqual(Array.from({ length: expectedFields }, () => true));
    }
    await assertPreviewText('#removed-duplicate', 'same');
    await assertPreviewText('#remaining-substring', 'prefix same');
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(previewOnlyFixture);
    verified.push(
      'removed literal nodes: no duplicate-definition rebinding and no substring match inside a dynamic Text node; all affected controls disabled, no IPC writes',
    );
  }, 60_000);

  it.each([
    'before initial selection',
    'after initial selection',
    'changed and moved before initial selection',
  ])('never binds a removed static A to the dynamic A survivor %s', async (timing) => {
    const effect =
      timing === 'before initial selection'
        ? `React.useLayoutEffect(()=>{const host=document.getElementById('history');if(host?.firstChild)host.removeChild(host.firstChild);document.documentElement.dataset.removed='yes'},[]);`
        : timing === 'changed and moved before initial selection'
          ? `React.useLayoutEffect(()=>{const host=document.getElementById('history');const first=host?.firstChild;if(first){first.textContent='Z';document.getElementById('destination').appendChild(first)}document.documentElement.dataset.removed='yes'},[]);`
          : '';
    const source = `function App(){${effect}return <main><h1>Mutation history</h1><p id="history">{'A'}{String('A')}{'B'}</p><div id="destination"/></main>}`;
    await writeFile(join(workspace, 'App.jsx'), source);
    await page.reload();
    await artifact();
    await enterEdit();
    const frame = await artifact('#history');
    if (timing !== 'after initial selection') {
      await frame.waitForFunction(() => document.documentElement.dataset['removed'] === 'yes');
    } else {
      await selectText('#history', 'A');
      expect(await fieldDisabled('A')).toBe(false);
      await frame.$eval('#history', (node) => {
        if (node.firstChild) node.removeChild(node.firstChild);
      });
    }
    await frame.click('#history');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('aside textarea')).some(
        (node) => node instanceof HTMLTextAreaElement && node.value === 'A' && node.disabled,
      ),
    );
    expect(await fieldDisabled('A')).toBe(true);
    await assertPreviewText('#history', 'AB');
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(source);
    verified.push(
      `mutation history ${timing}: source static A/dynamic A/static B loses first node; remaining dynamic A never authorizes removed static definition, no disk write`,
    );
  }, 60_000);

  it('revalidates a selected field before save and refuses an intervening runtime mutation', async () => {
    await loadPreviewOnlyFixture();
    await enterEdit();
    await selectText('#between', 'Stable text');
    expect(await fieldDisabled('Stable text')).toBe(false);
    const frame = await artifact();
    await frame.evaluate(() => {
      const mutateBeforeValidation = (event: MessageEvent) => {
        if (event.data?.type !== 'TEST_MUTATE_BEFORE_SAVE') return;
        const node = document.querySelector('#between');
        if (node) node.textContent = 'Runtime changed';
        window.removeEventListener('message', mutateBeforeValidation);
      };
      window.addEventListener('message', mutateBeforeValidation);
    });
    const iframe = await frame.frameElement();
    if (!iframe) throw new Error('Missing selected preview iframe');
    await iframe.evaluate((node) => {
      const save = document.querySelector('[aria-label="Save source definition: Text 1"]');
      // Same-window FIFO delivers this mutation before the real click/submit
      // validation request, without intercepting or replacing either protocol message.
      save?.addEventListener(
        'pointerdown',
        () => {
          (node as HTMLIFrameElement).contentWindow?.postMessage(
            { type: 'TEST_MUTATE_BEFORE_SAVE' },
            '*',
          );
        },
        { capture: true, once: true },
      );
    });
    await saveText('Stable text', 'Must not save');
    await page.waitForFunction(() =>
      document.querySelector('aside[aria-busy]')?.textContent?.includes('could not be verified'),
    );
    expect((await validationReplies()).length).toBeGreaterThan(0);
    expect(records.filter((record) => record.method === 'apply')).toHaveLength(0);
    expect(await disk()).toBe(previewOnlyFixture);
    await assertPreviewText('#between', 'Runtime changed');
    verified.push(
      'commit-time SOURCE_EDIT_VALIDATE real iframe roundtrip rejects mutation after selection before any apply IPC; no source bytes changed',
    );
  }, 60_000);

  it('persists an exact text patch through the full FilesTab UI', async () => {
    await (await artifact()).click('button');
    expect(await (await artifact()).$eval('button', (node) => node.textContent)).toBe('Count 1');
    await enterEdit();
    await (await artifact()).click('h1');
    await save('Text 1', 'Edited heading');
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
