import { createServer, type Server } from 'node:http';
import { findSystemChrome } from '@open-codesign/exporters';
import {
  buildInteractivePreviewDocument,
  buildPreviewDocument,
  INTERACTIVE_PREVIEW_SANDBOX,
} from '@open-codesign/runtime';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const chrome = await findSystemChrome().catch(() => null);
const reactForm = `function App() {
  const [count, setCount] = React.useState(0);
  return <form onSubmit={e => {e.preventDefault(); setCount(n => n + 1);}}>
    <input id="name" required />
    <button id="save">Save</button><output>{count}</output>
  </form>;
}`;

describe.skipIf(!chrome)('interactive preview form boundary in system Chrome', () => {
  let browser: Browser;
  let server: Server;
  let endpoint: string;
  const requests: string[] = [];

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.end('received');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
    endpoint = `http://127.0.0.1:${address.port}/submit`;
    expect(
      await (await fetch(endpoint, { method: 'POST', headers: { Connection: 'close' } })).text(),
    ).toBe('received');
    expect(requests).toEqual(['POST /submit']);
    browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  }, 30_000);

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    }
  }, 30_000);

  async function mount(source: string, path = 'App.jsx', legacy = false) {
    const page = await browser.newPage();
    await page.setContent('<iframe title="fixture"></iframe>');
    await page.$eval(
      'iframe',
      (node, options) => {
        node.sandbox.value = options.sandbox;
        node.srcdoc = options.document;
      },
      {
        sandbox: legacy ? 'allow-scripts' : INTERACTIVE_PREVIEW_SANDBOX,
        document: legacy
          ? buildPreviewDocument(source, { path })
          : buildInteractivePreviewDocument(source, { path }),
      },
    );
    const frame = await (await page.$('iframe'))?.contentFrame();
    if (!frame) throw new Error('Missing fixture frame');
    return { page, frame };
  }

  it('reproduces the legacy block then allows React click and Enter with native validation', async () => {
    for (const legacy of [true, false]) {
      const { page, frame } = await mount(reactForm, 'App.jsx', legacy);
      try {
        await frame.waitForSelector('#save');
        await frame.click('#save');
        expect(await frame.$eval('output', (n) => n.textContent)).toBe('0');
        await frame.type('#name', 'Visitor');
        await frame.click('#save');
        expect(await frame.$eval('output', (n) => n.textContent)).toBe(legacy ? '0' : '1');
        await frame.focus('#name');
        await page.keyboard.press('Enter');
        expect(await frame.$eval('output', (n) => n.textContent)).toBe(legacy ? '0' : '2');
        expect(frame.url()).toBe('about:srcdoc');
      } finally {
        await page.close();
      }
    }
  }, 30_000);

  async function expectNoTransmission(page: Page, frame: Frame, baseline: number) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests.slice(baseline)).toEqual([]);
    expect(page.url()).toBe('about:blank');
    expect(frame.url()).toBe('about:srcdoc');
    expect((await browser.pages()).length).toBe(2);
  }

  it('blocks native submits, requestSubmit, targets and popups even after policy meta removal', async () => {
    const source = `<html><head></head><body>
      <form id="form" method="post" action="${endpoint}"><input name="payload" value="fixture" /><button id="save">Send</button></form>
    </body></html>`;
    const { page, frame } = await mount(source, 'index.html');
    try {
      await frame.waitForSelector('#save');
      const baseline = requests.length;
      await frame.click('#save');
      await frame.evaluate(() => {
        const form = document.querySelector('form');
        form?.requestSubmit();
        document.querySelector('[data-codesign-form-policy]')?.remove();
        form?.submit();
      });
      await expectNoTransmission(page, frame, baseline);
      for (const target of ['_self', '_parent', '_top', '_blank']) {
        await frame.evaluate((target) => {
          const form = document.querySelector('form');
          if (!form) throw new Error('Form missing');
          form.target = target;
          HTMLFormElement.prototype.submit.call(form);
        }, target);
        await expectNoTransmission(page, frame, baseline);
      }
      await frame.evaluate((url) => {
        window.open(url, '_blank');
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        document.body.append(link);
        link.click();
      }, endpoint);
      await expectNoTransmission(page, frame, baseline);
    } finally {
      await page.close();
    }
  }, 30_000);

  it.each([
    '<html><script>ATTACK</script><head></head><body>Early</body></html>',
    '<!doctype html><html><head/><script>ATTACK</script><body>Malformed</body></html>',
  ])('applies CSP before early authored scripts: %s', async (template) => {
    const baseline = requests.length;
    const source = template.replace(
      'ATTACK',
      `var f=document.createElement('form');f.action=${JSON.stringify(endpoint)};f.method='post';document.documentElement.append(f);f.submit();window.open(${JSON.stringify(endpoint)},'_blank');`,
    );
    const { page, frame } = await mount(source, 'index.html');
    try {
      await frame.waitForSelector('form');
      await expectNoTransmission(page, frame, baseline);
    } finally {
      await page.close();
    }
  }, 30_000);
});
