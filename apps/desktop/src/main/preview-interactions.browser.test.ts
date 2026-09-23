import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PreviewStep } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPreviewSteps } from './preview-interactions';

const chrome = await findSystemChrome().catch(() => null);
const controls = `
  <input id="input" value="initial">
  <textarea id="textarea">initial</textarea>
  <button id="button" type="button">Activate</button>
  <select id="select"><option value="initial">Initial</option><option value="changed">Changed</option></select>
`;
const actions: PreviewStep[] = [
  { action: 'fill', selector: '#input', value: 'changed' },
  { action: 'fill', selector: '#textarea', value: 'changed' },
  { action: 'click', selector: '#button' },
  { action: 'press', selector: '#input', key: 'Enter' },
  { action: 'press', selector: '#textarea', key: 'Enter' },
  { action: 'press', selector: '#button', key: 'Enter' },
  { action: 'select', selector: '#select', value: 'changed' },
];

describe.skipIf(!chrome)('preview control actionability in system Chrome', () => {
  let browser: Browser;
  let page: Page;
  let profile: string;

  beforeAll(async () => {
    if (!chrome) throw new Error('System Chrome unavailable');
    profile = resolve(`.preview-interactions-browser-${randomUUID()}`);
    mkdirSync(profile);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: profile,
      args: ['--disable-background-networking'],
    });
  }, 30_000);

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      if (profile) rmSync(profile, { recursive: true, force: true });
    }
  }, 30_000);

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => void request.abort());
  });

  afterEach(async () => {
    await page?.close();
  });

  async function mount(markup: string) {
    await page.setContent(`<!doctype html>${markup}
      <output id="events" data-events=""></output>
      <script>
        for (const name of ['input', 'change', 'click', 'keydown', 'focusin']) {
          document.addEventListener(name, event => {
            const output = document.querySelector('#events');
            output.setAttribute('data-events', output.getAttribute('data-events') + event.type + ':' + event.target.id + ';');
          });
        }
      </script>`);
  }

  async function recordedEvents() {
    return page.evaluate("document.querySelector('#events').getAttribute('data-events')");
  }

  async function expectBlocked(step: PreviewStep) {
    const results = await runPreviewSteps(page, [
      step,
      { action: 'assert', selector: '#events', text: 'must not execute' },
    ]);
    expect(results).toEqual([
      {
        index: 0,
        action: step.action,
        selector: step.selector,
        ok: false,
        reason: 'Element is disabled or inert',
      },
    ]);
    expect(
      await runPreviewSteps(page, [
        { action: 'assert', selector: '#input', value: 'initial' },
        { action: 'assert', selector: '#textarea', value: 'initial' },
        { action: 'assert', selector: '#select', value: 'initial' },
      ]),
    ).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(await recordedEvents()).toBe('');
  }

  describe.each(['body', 'second legend'])('disabled fieldset %s', (location) => {
    it.each(actions)('blocks $action on $selector without events or mutation', async (step) => {
      await mount(
        `<fieldset disabled><legend>First legend</legend>${
          location === 'body' ? controls : `<legend>${controls}</legend>`
        }</fieldset>`,
      );
      expect(
        await page.$eval(step.selector, (element) => ({
          ownDisabled: element.hasAttribute('disabled'),
          effectivelyDisabled: element.matches(':disabled'),
        })),
      ).toEqual({ ownDisabled: false, effectivelyDisabled: true });
      await expectBlocked(step);
    });
  });

  it.each(actions)('allows $action on $selector in the first legend', async (step) => {
    await mount(`<fieldset disabled><legend>${controls}</legend></fieldset>`);
    expect(await page.$eval(step.selector, (element) => element.matches(':disabled'))).toBe(false);
    expect(await runPreviewSteps(page, [step])).toEqual([
      { index: 0, action: step.action, selector: step.selector, ok: true },
    ]);
    if (step.action === 'fill' || step.action === 'select') {
      expect(
        await runPreviewSteps(page, [
          { action: 'assert', selector: step.selector, value: 'changed' },
        ]),
      ).toEqual([expect.objectContaining({ ok: true })]);
    }
    const event =
      step.action === 'fill' || step.action === 'select'
        ? 'change'
        : step.action === 'click'
          ? 'click'
          : 'keydown';
    expect(await recordedEvents()).toContain(`${event}:${step.selector.slice(1)};`);
  });

  it.each(
    actions,
  )('blocks $action on directly disabled $selector in the first legend', async (step) => {
    await mount(`<fieldset disabled><legend>${controls}</legend></fieldset>`);
    await page.$eval(step.selector, (element) => element.setAttribute('disabled', ''));
    await expectBlocked(step);
  });

  it.each([
    'inert',
    'aria-disabled="true"',
  ])('still blocks first-legend controls beneath %s', async (attribute) => {
    await mount(
      `<fieldset disabled><legend><div ${attribute}>${controls}</div></legend></fieldset>`,
    );
    await expectBlocked({ action: 'fill', selector: '#input', value: 'changed' });
  });
});
