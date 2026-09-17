import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import { parseEditmodeBlock } from '@open-codesign/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspacePreviewWrite } from '../preview/tweak-persistence';
import type {} from './__fixtures__/tweak-browser';

const chrome = await findSystemChrome();
const source =
  'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"heading":"Convergence v2","accent":"#294c60","gap":16,"enabled":true}/*EDITMODE-END*/;';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!chrome)('tweak keyboard persistence in system Chrome', () => {
  let browser: Browser;
  let server: ViteDevServer;
  let page: Page;
  let directory: string;
  let endpoint: string;
  let saveDelay = 0;
  let ackDelay = 0;
  let readDelay = 0;
  let started = 0;
  let writes: Parameters<WorkspacePreviewWrite>[];
  const activeWrites = new Set<Promise<unknown>>();
  let errors: string[];
  const file = (design: string, path: string) => join(directory, `${design}-${path}`);

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    directory = await mkdtemp(join(tmpdir(), 'codesign-tweak-browser-'));
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      server: { host: '127.0.0.1', port: 0 },
      plugins: [
        {
          name: 'tweak-browser-fixture',
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.split('?')[0] !== '/tweak-fixture') return next();
              res.setHeader('Content-Type', 'text/html');
              res.end(
                '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/renderer/src/components/__fixtures__/tweak-browser.tsx"></script></body></html>',
              );
            });
          },
        },
      ],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
    endpoint = `http://127.0.0.1:${address.port}/tweak-fixture`;
    expect((await fetch(endpoint)).ok).toBe(true);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: join(directory, 'chrome-profile'),
    });
  }, 60_000);

  beforeEach(async () => {
    saveDelay = 0;
    ackDelay = 0;
    readDelay = 0;
    started = 0;
    writes = [];
    errors = [];
    await writeFile(file('first', 'App.jsx'), source);
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === new URL(endpoint).origin) void request.continue();
      else {
        errors.push(`Unexpected network request: ${request.url()}`);
        void request.abort();
      }
    });
    await page.exposeFunction('tweakRead', async (design: string, path: string) => {
      await pause(readDelay);
      return { path, content: await readFile(file(design, path), 'utf8') };
    });
    const write: WorkspacePreviewWrite = async (design, path, content, options) => {
      started++;
      await pause(saveDelay);
      const current = await readFile(file(design, path), 'utf8');
      if (!options || current !== options.expectedContent) throw new Error('Source conflict');
      await writeFile(file(design, path), content);
      writes.push([design, path, content, options]);
      await pause(ackDelay);
      return { path, content };
    };
    await page.exposeFunction('tweakWrite', (...args: Parameters<WorkspacePreviewWrite>) => {
      const pending = write(...args);
      activeWrites.add(pending);
      void pending.then(
        () => activeWrites.delete(pending),
        () => activeWrites.delete(pending),
      );
      return pending;
    });
    await page.goto(endpoint);
    await page.waitForSelector('fieldset input[type="text"]');
  }, 60_000);

  afterEach(async () => {
    await Promise.allSettled(activeWrites);
    await page?.close();
    expect(errors).toEqual([]);
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function replace(selector: string, value: string) {
    const input = await page.$(selector);
    if (!input) throw new Error('Missing input');
    await input.focus();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.type(value, { delay: 20 });
    expect(
      await input.evaluate((node) => node.isConnected && document.activeElement === node),
    ).toBe(true);
    return input;
  }

  async function tokens(design = 'first', path = 'App.jsx') {
    return parseEditmodeBlock(await readFile(file(design, path), 'utf8'))?.tokens;
  }

  it('preserves real runtime component state through live edits, disk ACK, and watcher refresh', async () => {
    const artifact = `${source}
window.moduleRuns = (window.moduleRuns || 0) + 1;
function App() {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => { window.effectRuns = (window.effectRuns || 0) + 1; }, []);
  const copiedTokens = structuredClone(TWEAK_DEFAULTS);
  return <main>
    <h1 style={{color: TWEAK_DEFAULTS.accent}}>{copiedTokens.heading}</h1>
    <button id="counter" onClick={() => setCount(n => n + 1)}>Count {count}</button>
    <input id="artifact-input" />
  </main>;
}`;
    await writeFile(file('first', 'App.jsx'), artifact);
    await page.goto(`${endpoint}?workspace=1`);
    await page.waitForSelector('iframe');
    const frame = await (await page.$('iframe'))?.contentFrame();
    if (!frame) throw new Error('Missing runtime iframe');
    await frame.waitForSelector('#counter');
    await frame.click('#counter');
    await frame.type('#artifact-input', 'Retain through tweak');
    await page.click('[aria-label="Open tweaks panel"]');
    const heading = await replace('fieldset input[type="text"]', 'Convergence v2 verified');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('Convergence v2 verified');
    await page.evaluate(() => window.tweakFixture.refreshWorkspace());
    await frame.waitForFunction(
      () => document.querySelector('h1')?.textContent === 'Convergence v2 verified',
    );
    expect(await frame.$eval('#counter', (node) => node.textContent)).toBe('Count 1');
    expect(await frame.$eval('#artifact-input', (node) => (node as HTMLInputElement).value)).toBe(
      'Retain through tweak',
    );
    expect(await frame.evaluate(() => Reflect.get(window, 'moduleRuns'))).toBe(1);
    expect(await frame.evaluate(() => Reflect.get(window, 'effectRuns'))).toBe(1);
    expect(await page.$eval('[data-runtime-errors]', (node) => node.textContent)).toBe('');
    expect(await page.$eval('output', (node) => node.textContent)).toBe('');
    expect(await heading.evaluate((node) => document.activeElement === node)).toBe(true);
    await replace('fieldset label + input', '#abcdef');
    await expect.poll(async () => (await tokens())?.['accent']).toBe('#abcdef');
    await page.evaluate(() => window.tweakFixture.refreshWorkspace());
    await frame.waitForFunction(() => {
      const heading = document.querySelector('h1');
      return heading && getComputedStyle(heading).color === 'rgb(171, 205, 239)';
    });
    expect(await frame.$eval('#counter', (node) => node.textContent)).toBe('Count 1');
    const structural = (await readFile(file('first', 'App.jsx'), 'utf8')).replace(
      '<main>',
      '<main data-revision="external">',
    );
    await page.evaluate(() =>
      Reflect.set(window, 'oldPreviewWindow', document.querySelector('iframe')?.contentWindow),
    );
    await writeFile(file('first', 'App.jsx'), structural);
    await page.evaluate(() => window.tweakFixture.refreshWorkspace());
    await page.waitForFunction(() =>
      document.querySelector('iframe')?.srcdoc.includes('data-revision'),
    );
    const nextFrame = await (await page.$('iframe'))?.contentFrame();
    if (!nextFrame) throw new Error('Missing revised runtime iframe');
    await nextFrame.waitForSelector('[data-revision="external"]');
    expect(await nextFrame.$eval('#counter', (node) => node.textContent)).toBe('Count 0');
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: Reflect.get(window, 'oldPreviewWindow'),
          data: { type: 'codesign:tweaks:compatibility', message: 'Stale artifact notice' },
        }),
      );
      window.postMessage(
        { type: 'codesign:tweaks:compatibility', message: 'Wrong host notice' },
        '*',
      );
    });
    await pause(100);
    expect(await page.$eval('output', (node) => node.textContent)).toBe('');
  }, 30_000);

  it.each([
    [
      'top-level derived token',
      'const heading = TWEAK_DEFAULTS.heading; function App() { return <h1>{heading}</h1>; }',
    ],
    [
      'top-level cloned tokens',
      'const copied = structuredClone(TWEAK_DEFAULTS); function App() { return <h1>{copied.heading}</h1>; }',
    ],
    [
      'static JSX root',
      'ReactDOM.createRoot(document.getElementById("root")).render(<h1>{TWEAK_DEFAULTS.heading}</h1>);',
    ],
    [
      'fragment root',
      'function Heading() { return <h1>{TWEAK_DEFAULTS.heading}</h1>; } ReactDOM.createRoot(document.getElementById("root")).render(<><Heading/></>);',
    ],
    [
      'memo root',
      'const App = React.memo(function App() { return <h1>{TWEAK_DEFAULTS.heading}</h1>; });',
    ],
    [
      'nested memo',
      'const Heading = React.memo(() => <h1>{TWEAK_DEFAULTS.heading}</h1>); function App() { return <Heading />; }',
    ],
    [
      'PureComponent root',
      'class App extends React.PureComponent { render() { return <h1>{TWEAK_DEFAULTS.heading}</h1>; } } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
    ],
    [
      'nested PureComponent',
      'class Heading extends React.PureComponent { render() { return <h1>{TWEAK_DEFAULTS.heading}</h1>; } } function App() { return <Heading />; }',
    ],
  ])(
    'keeps %s tweaks updating with a visible compatibility limitation',
    async (_name, body) => {
      await writeFile(file('first', 'App.jsx'), `${source}\n${body}`);
      await page.goto(`${endpoint}?workspace=1`);
      await page.waitForSelector('iframe');
      const frame = await (await page.$('iframe'))?.contentFrame();
      if (!frame) throw new Error('Missing runtime iframe');
      await frame.waitForSelector('h1');
      await page.click('[aria-label="Open tweaks panel"]');
      await replace('fieldset input[type="text"]', 'Compatible updated heading');
      await expect
        .poll(async () => (await tokens())?.['heading'])
        .toBe('Compatible updated heading');
      await page.evaluate(() => window.tweakFixture.refreshWorkspace());
      await frame.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Compatible updated heading',
      );
      expect(await page.$eval('output', (node) => node.textContent)).toContain(
        'Updating tweaks reinitializes artifact state',
      );
      expect(await page.$eval('[data-runtime-errors]', (node) => node.textContent)).toBe('');
      expect(
        await page.$eval(
          'output',
          (node) => node.textContent?.match(/Live tweak compatibility mode/g)?.length,
        ),
      ).toBe(1);
    },
    30_000,
  );

  it('replays the latest manual root render while keeping its component state and effects', async () => {
    await writeFile(
      file('first', 'App.jsx'),
      `${source}
const root = ReactDOM.createRoot(document.getElementById('root'));
function Other() {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => { window.effectRuns = (window.effectRuns || 0) + 1; }, []);
  return <main><h1>{TWEAK_DEFAULTS.heading}</h1><button id="counter" onClick={() => setCount(n => n+1)}>Count {count}</button></main>;
}
function App() { return <button id="switch" onClick={() => root.render(<Other/>)}>Switch manually</button>; }
root.render(<App/>);`,
    );
    await page.goto(`${endpoint}?workspace=1`);
    await page.waitForSelector('iframe');
    const frame = await (await page.$('iframe'))?.contentFrame();
    if (!frame) throw new Error('Missing runtime iframe');
    await frame.waitForSelector('#switch');
    await frame.click('#switch');
    await frame.click('#counter');
    await page.click('[aria-label="Open tweaks panel"]');
    await replace('fieldset input[type="text"]', 'Manual root updated');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('Manual root updated');
    await page.evaluate(() => window.tweakFixture.refreshWorkspace());
    await frame.waitForFunction(
      () => document.querySelector('h1')?.textContent === 'Manual root updated',
    );
    expect(await frame.$eval('#counter', (node) => node.textContent)).toBe('Count 1');
    expect(await frame.evaluate(() => Reflect.get(window, 'effectRuns'))).toBe(1);
    expect(await page.$eval('[data-runtime-errors]', (node) => node.textContent)).toBe('');
  }, 30_000);

  it.each([
    ['en', 'Open tweaks panel', 'Updating tweaks reinitializes artifact state.'],
    ['zh-CN', '打开微调面板', '更新微调值会重置作品的交互状态。'],
    ['es', 'Abrir panel de ajustes', 'Actualizar los ajustes reinicia su estado de interacción.'],
    ['pt-BR', 'Abrir painel de ajustes', 'Atualizar os ajustes reinicia seu estado de interação.'],
  ])(
    'localizes the nonfatal compatibility notice in %s',
    async (locale, label, message) => {
      await writeFile(
        file('first', 'App.jsx'),
        `${source}
const heading = TWEAK_DEFAULTS.heading;
function App() { return <h1>{heading}</h1>; }`,
      );
      await page.goto(`${endpoint}?workspace=1&locale=${locale}`);
      await page.waitForSelector('iframe');
      const frame = await (await page.$('iframe'))?.contentFrame();
      if (!frame) throw new Error('Missing runtime iframe');
      await frame.waitForSelector('h1');
      await page.click(`button[aria-label="${label}"]`);
      await replace('fieldset input[type="text"]', 'Localized compatibility');
      await expect.poll(async () => (await tokens())?.['heading']).toBe('Localized compatibility');
      await frame.waitForFunction(
        () => document.querySelector('h1')?.textContent === 'Localized compatibility',
      );
      expect(await page.$eval('output', (node) => node.textContent)).toContain(message);
      expect(await page.$eval('[data-runtime-errors]', (node) => node.textContent)).toBe('');
      if (locale !== 'en')
        expect(await page.$eval('output', (node) => node.textContent)).not.toContain(
          'Live tweak compatibility mode',
        );
    },
    30_000,
  );

  it('retains the heading DOM node through full keyboard replacement and guarded disk save', async () => {
    const input = await replace('fieldset input[type="text"]', 'Convergence v2 verified');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('Convergence v2 verified');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(await input.evaluate((node) => getComputedStyle(node).fontSize)).toBe('12px');
    expect(writes[0]?.[3]?.expectedContent).toBe(source);
  });

  it('retains the hex editor DOM node even while its partial value is not a color', async () => {
    const input = await replace('fieldset label + input', '#abcdef');
    await expect.poll(async () => (await tokens())?.['accent']).toBe('#abcdef');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
  });

  it('keeps focus and newer edits across the debounce and a slow save', async () => {
    saveDelay = 900;
    const input = await page.$('fieldset input[type="text"]');
    if (!input) throw new Error('Missing heading');
    await input.focus();
    await page.keyboard.press('End');
    await page.keyboard.type(' first');
    await expect.poll(() => started).toBe(1);
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    await page.keyboard.type(' second');
    await expect
      .poll(async () => (await tokens())?.['heading'], { timeout: 5_000 })
      .toBe('Convergence v2 first second');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.[3]?.expectedContent).toBe(writes[0]?.[2]);
  });

  it('recognizes browser-supported colors, not arbitrary words or CSS-wide keywords', async () => {
    expect(
      await page.evaluate(() =>
        window.tweakFixture.colors([
          'Convergence',
          'C',
          'banana',
          '#',
          'red',
          'rebeccapurple',
          'transparent',
          '#1234',
          'oklch(50% 0.1 120)',
          'rgb(nonsense)',
          'inherit',
          'var(--accent)',
        ]),
      ),
    ).toEqual([false, false, false, false, true, true, true, true, true, false, false, false]);
  });

  it('does not reclassify a text draft that becomes a valid color across its own ACK', async () => {
    const input = await replace('fieldset input[type="text"]', 'red');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('red');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'false',
    );
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    await page.keyboard.type(' heading');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('red heading');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(await page.$$('input[type="color"]')).toHaveLength(1);
  });

  it('keeps a partial hex editor focused when typing resumes after a saved pause', async () => {
    const input = await replace('fieldset label + input', '#');
    await expect.poll(async () => (await tokens())?.['accent']).toBe('#');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'false',
    );
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    await page.keyboard.type('102030');
    await expect.poll(async () => (await tokens())?.['accent']).toBe('#102030');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
  });

  it('keeps newer drafts and artifact state when a watcher echoes our write before its ACK', async () => {
    ackDelay = 900;
    const frame = page.frames().find((frame) => frame.parentFrame());
    if (!frame) throw new Error('Missing artifact frame');
    await frame.$eval('input', (input) => {
      input.value = 'Independent artifact state';
    });
    const input = await replace('fieldset input[type="text"]', 'red');
    await expect.poll(() => writes.length).toBe(1);
    const echo = writes[0]?.[2];
    if (!echo) throw new Error('Missing own write');
    await page.evaluate(
      (content) =>
        window.tweakFixture.replace('first', {
          path: 'App.jsx',
          content,
        }),
      echo,
    );
    await page.keyboard.type(' plus newer draft');
    await expect
      .poll(async () => (await tokens())?.['heading'], { timeout: 5_000 })
      .toBe('red plus newer draft');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'false',
    );
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(await frame.$eval('input', (input) => input.value)).toBe('Independent artifact state');
    expect(await page.$$('input[type="color"]')).toHaveLength(1);
  });

  it('retains the recoverable draft and conflict error without retrying queued edits', async () => {
    saveDelay = 900;
    const input = await replace('fieldset input[type="text"]', 'Local draft');
    await expect.poll(() => started).toBe(1);
    await page.keyboard.type(' and newer text');
    const external = source.replace('Convergence v2', 'External edit');
    await writeFile(file('first', 'App.jsx'), external);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      external,
    );
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('Source conflict'),
    );
    await pause(500);
    expect(started).toBe(1);
    expect(writes).toHaveLength(0);
    expect((await tokens())?.['heading']).toBe('External edit');
    expect(await input.evaluate((node) => node instanceof HTMLInputElement && node.value)).toBe(
      'Local draft and newer text',
    );
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
  });

  it('resets inferred controls on an independent source replacement', async () => {
    const external = source.replace('Convergence v2', 'red').replace('#294c60', 'Brand heading');
    await writeFile(file('first', 'App.jsx'), external);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      external,
    );
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('fieldset label + input')?.value === 'red',
    );
    const input = await replace('fieldset label + input', '#123456');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('#123456');
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(await page.$$('input[type="color"]')).toHaveLength(1);
  });

  it('resets a numeric partial edit when the external source replaces the same control', async () => {
    await replace('input[inputmode="numeric"]', '-');
    const external = `${source}\n// External source revision`;
    await writeFile(file('first', 'App.jsx'), external);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      external,
    );
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.value === '16',
    );
    expect(writes).toHaveLength(0);
  });

  it('never publishes a late own ACK over a newer independent watcher update', async () => {
    ackDelay = 900;
    await replace('fieldset input[type="text"]', 'Saved local heading');
    await expect.poll(() => writes.length).toBe(1);
    const external = source.replace('Convergence v2', 'rebeccapurple');
    await writeFile(file('first', 'App.jsx'), external);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      external,
    );
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('fieldset label + input')?.value ===
        'rebeccapurple',
    );
    expect(await tokens()).toEqual(parseEditmodeBlock(external)?.tokens);
    expect(writes).toHaveLength(1);
    expect(await page.$$('input[type="color"]')).toHaveLength(2);
  });

  it('merges unrelated external token edits without replaying stale values from a queued draft', async () => {
    ackDelay = 900;
    const input = await replace('fieldset input[type="text"]', 'Local first');
    await expect.poll(() => writes.length).toBe(1);
    const external = (writes[0]?.[2] ?? '').replace('"gap": 16', '"gap": 24');
    await writeFile(file('first', 'App.jsx'), external);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      external,
    );
    await page.keyboard.type(' second');
    await expect
      .poll(async () => (await tokens())?.['heading'], { timeout: 5_000 })
      .toBe('Local first second');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'false',
    );
    expect((await tokens())?.['gap']).toBe(24);
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect(
      await page.$eval('input[inputmode="numeric"]', (node) => (node as HTMLInputElement).value),
    ).toBe('24');
  });

  it('stops a queued save when generation starts before its read completes', async () => {
    readDelay = 900;
    await replace('fieldset input[type="text"]', 'Cancelled local heading');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'true',
    );
    await page.evaluate(() => window.tweakFixture.generating());
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.includes('generation started'),
    );
    await pause(1_100);
    expect(started).toBe(0);
    expect(await tokens()).toEqual(parseEditmodeBlock(source)?.tokens);
  });

  it.each([
    'file',
    'design',
  ] as const)('resets controls on a %s switch and ignores an old ACK', async (kind) => {
    ackDelay = 900;
    await replace('fieldset input[type="text"]', 'Original design draft');
    await expect.poll(() => writes.length).toBe(1);
    const design = kind === 'design' ? 'second' : 'first';
    const path = kind === 'file' ? 'Other.jsx' : 'App.jsx';
    const content = source.replace('Convergence v2', 'blue');
    await writeFile(file(design, path), content);
    await page.evaluate(
      ({ design, path, content }) => window.tweakFixture.replace(design, { path, content }),
      { design, path, content },
    );
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('fieldset label + input')?.value === 'blue',
    );
    const input = await replace('fieldset label + input', '#123456');
    await expect.poll(async () => (await tokens(design, path))?.['heading']).toBe('#123456');
    await pause(1_000);
    expect(await input.evaluate((node) => document.activeElement === node)).toBe(true);
    expect((await tokens())?.['heading']).toBe('Original design draft');
  });

  it('cancels a save still awaiting a read on file switch', async () => {
    readDelay = 900;
    await replace('fieldset input[type="text"]', 'Never written');
    await page.waitForFunction(
      () => document.querySelector('fieldset')?.getAttribute('aria-busy') === 'true',
    );
    await writeFile(file('first', 'Other.jsx'), source);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'Other.jsx', content }),
      source,
    );
    await pause(1_100);
    expect(started).toBe(0);
    expect(await tokens()).toEqual(parseEditmodeBlock(source)?.tokens);
    expect(
      await page.$eval('fieldset input[type="text"]', (node) => (node as HTMLInputElement).value),
    ).toBe('Convergence v2');
  });

  it('preserves explicit schema control kinds and numeric/boolean editing', async () => {
    const explicit = `${source.replace('Convergence v2', 'red').replace('#294c60', 'Brand text')}
const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"heading":{"kind":"string"},"accent":{"kind":"color"}}/*TWEAK-SCHEMA-END*/;`;
    await writeFile(file('first', 'App.jsx'), explicit);
    await page.evaluate(
      (content) => window.tweakFixture.replace('first', { path: 'App.jsx', content }),
      explicit,
    );
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('fieldset label + input')?.value === 'Brand text',
    );
    await replace('fieldset input[type="text"]', 'green');
    await expect.poll(async () => (await tokens())?.['heading']).toBe('green');
    await replace('input[inputmode="numeric"]', '24');
    await page.click('[role="switch"]');
    await expect.poll(async () => (await tokens())?.['gap']).toBe(24);
    expect((await tokens())?.['enabled']).toBe(false);
    expect(await page.$$('input[type="color"]')).toHaveLength(1);
  });
});
