import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSystemChrome } from '@open-codesign/exporters';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DesignSystemLibrary } from './design-system-library';
import { runPreview } from './preview-runtime';

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const chromeAvailable = await findSystemChrome().then(
  () => true,
  () => false,
);
describe.skipIf(!chromeAvailable)('built-in design systems in the real preview runtime', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'systems-browser-'));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each([
    'ibm',
    'vercel',
    'stripe',
  ])('renders %s, exercises controls and captures a verified thumbnail', async (slug) => {
    const library = new DesignSystemLibrary({
      root: path.join(root, 'library'),
      builtinRoot: path.resolve('resources/templates/brand-refs'),
    });
    const detail = await library.get(`builtin:${slug}`);
    const workspace = path.join(root, slug);
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'App.jsx'), detail.previewSource);
    const report = await runPreview({
      workspaceRoot: workspace,
      path: 'App.jsx',
      vision: true,
      viewport: { width: 1280, height: 960 },
      steps: [
        { action: 'click', selector: '[data-design-system-role="primary-button"]:not([disabled])' },
        { action: 'assert', selector: '[role="status"]', text: '已保存' },
        { action: 'fill', selector: 'input', value: '中文' },
        { action: 'assert', selector: 'tbody', text: '中文排版规范' },
        { action: 'click', selector: 'nav button:nth-child(2)' },
        { action: 'assert', selector: '.ds-hero', text: 'Components' },
        { action: 'fill', selector: 'input', value: '' },
        { action: 'click', selector: '.ds-button.secondary' },
        { action: 'click', selector: 'nav button:first-child' },
      ],
    });
    expect(report.ok, JSON.stringify({ ...report, screenshot: undefined })).toBe(true);
    expect(report.consoleErrors.filter((e) => e.level === 'error')).toEqual([]);
    expect(report.assetErrors).toEqual([]);
    expect(report.steps?.every((step) => step.ok)).toBe(true);
    expect(report.screenshot).toContain('data:image/png;base64,');
    const evidence = path.join(root, 'evidence');
    await mkdir(evidence, { recursive: true });
    await writeFile(
      path.join(evidence, `${slug}.png`),
      Buffer.from((report.screenshot ?? '').split(',')[1] ?? '', 'base64'),
    );
    expect(await readFile(path.join(workspace, 'App.jsx'), 'utf8')).toBe(detail.previewSource);
  }, 45000);
});
