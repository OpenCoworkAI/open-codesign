import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_WARNING_SOURCE, trimPreviewResult } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';
import { PHONE_VIEWPORT } from './layout-probe';
import { runPreview } from './preview-runtime';

vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

const chromeAvailable = await findSystemChrome().then(
  () => true,
  () => false,
);

const jsx = (style: string) =>
  `function App(){return <main style={${style}}>Quarterly report</main>;} ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`;
const FITS = jsx('{ padding: 16 }');
const TOO_WIDE = jsx('{ width: 900, padding: 16 }');

describe.skipIf(!chromeAvailable)('layout checks reach done and preview', () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'codesign-layout-wiring-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('done lists a page that scrolls sideways at phone width as a warning, not an error', async () => {
    const { errors, warnings } = await makeRuntimeVerifier({ workspaceRoot: workspace })(TOO_WIDE, {
      path: 'App.jsx',
    });

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.source).toBe(LAYOUT_WARNING_SOURCE);
    expect(warnings[0]?.message).toMatch(
      new RegExp(`past the ${PHONE_VIEWPORT.width} px viewport edge`),
    );
  }, 60_000);

  it('done reports no warning for a page that fits at both widths', async () => {
    const result = await makeRuntimeVerifier({ workspaceRoot: workspace })(FITS, {
      path: 'App.jsx',
    });

    expect(result).toEqual({ errors: [], warnings: [] });
  }, 60_000);

  it('preview returns the same finding as layoutIssues and still reports ok', async () => {
    await writeFile(join(workspace, 'App.jsx'), TOO_WIDE);

    const preview = await runPreview({ workspaceRoot: workspace, path: 'App.jsx', vision: false });

    expect(preview.ok).toBe(true);
    expect(preview.layoutIssues).toHaveLength(1);
    expect(preview.layoutIssues?.[0]).toMatchObject({
      check: 'horizontal-overflow',
      viewportWidth: PHONE_VIEWPORT.width,
    });
    expect(trimPreviewResult(preview).layoutIssues).toEqual(preview.layoutIssues);
  }, 60_000);

  it('preview leaves layoutIssues out for a page that fits, and measures a vision preview too', async () => {
    await writeFile(join(workspace, 'App.jsx'), FITS);

    const text = await runPreview({ workspaceRoot: workspace, path: 'App.jsx', vision: false });
    const vision = await runPreview({ workspaceRoot: workspace, path: 'App.jsx', vision: true });

    expect(text.layoutIssues).toBeUndefined();
    expect(text.warnings).toBeUndefined();
    expect(vision.layoutIssues).toBeUndefined();
    expect(vision.screenshot).toMatch(/^data:image\/png;base64,/);
    expect(vision.metrics.width).toBe(1280);
  }, 60_000);
});
