import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measurePreviewFocus } from './preview-focus';
import { collectVisibleEvidence } from './preview-interactions';
import { runPreview } from './preview-runtime';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  screenshot: vi.fn(),
  evaluate: vi.fn(),
  close: vi.fn(),
  viewport: vi.fn(),
  interactions: vi.fn(),
}));
vi.mock('puppeteer-core', () => ({ default: { launch: mocks.launch } }));
vi.mock('@open-codesign/exporters', () => ({ findSystemChrome: async () => 'synthetic-chrome' }));
vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock('./layout-probe', () => ({
  inspectLayout: async () => ({ issues: [], notes: [] }),
  layoutFailureWarning: vi.fn(),
}));
vi.mock('./preview-interactions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./preview-interactions')>()),
  runPreviewSteps: mocks.interactions,
}));

let root: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'codesign-focus-runtime-'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><!-- artifact source lives in App.jsx -->',
  );
  await writeFile(
    join(root, 'App.jsx'),
    'function App(){return <main id="pricing">Basic plan</main>}',
  );
  mocks.interactions.mockResolvedValue([
    { index: 0, action: 'click', selector: '#open', ok: true },
  ]);
  mocks.screenshot.mockResolvedValue('aW1n');
  mocks.close.mockResolvedValue(undefined);
  mocks.evaluate.mockImplementation(async (fn) => {
    if (fn === collectVisibleEvidence) return 'Basic plan';
    if (fn === measurePreviewFocus)
      return {
        tagName: 'main',
        text: 'Basic plan',
        outerHTML: '<main id="pricing">Basic plan</main>',
        bounds: { x: 20, y: 100, width: 300, height: 150 },
      };
    return { nodes: 10, width: 1280, height: 800 };
  });
  mocks.launch.mockResolvedValue({
    close: mocks.close,
    newPage: async () => ({
      setViewport: mocks.viewport,
      on: vi.fn(),
      setRequestInterception: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      goto: vi.fn(async () => null),
      evaluate: mocks.evaluate,
      screenshot: mocks.screenshot,
    }),
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('preview runtime focus integration without launching a browser', () => {
  it('captures after interactions, identifies the resolved source, and preserves the CSS viewport', async () => {
    const result = await runPreview({
      workspaceRoot: root,
      path: 'index.html',
      vision: true,
      viewport: { width: 390, height: 844 },
      steps: [{ action: 'click', selector: '#open' }],
      focus: { selector: '#pricing', scale: 3, padding: 0 },
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.focus).toMatchObject({
      sourcePath: 'App.jsx',
      selector: '#pricing',
      clip: { scale: 3 },
    });
    expect(result.screenshot).toBe('data:image/png;base64,aW1n');
    expect(mocks.viewport).toHaveBeenCalledExactlyOnceWith({ width: 390, height: 844 });
    expect(mocks.screenshot).toHaveBeenCalledExactlyOnceWith({
      type: 'png',
      encoding: 'base64',
      captureBeyondViewport: true,
      clip: { x: 20, y: 100, width: 300, height: 150, scale: 3 },
    });
    expect(mocks.interactions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.screenshot.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('preserves the original full-viewport screenshot when focus is omitted', async () => {
    const result = await runPreview({ workspaceRoot: root, path: 'App.jsx', vision: true });
    expect(result.ok, result.reason).toBe(true);
    expect(result.focus).toBeUndefined();
    expect(mocks.screenshot).toHaveBeenCalledExactlyOnceWith({ type: 'png', encoding: 'base64' });
  });

  it('reports focus capture failure and closes the owned browser', async () => {
    mocks.screenshot.mockRejectedValueOnce(new Error('Failed to capture region'));
    const result = await runPreview({
      workspaceRoot: root,
      path: 'App.jsx',
      vision: true,
      focus: { selector: '#pricing' },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Failed to capture region');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
