import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_WARNING_SOURCE } from '@open-codesign/core';
import { findSystemChrome } from '@open-codesign/exporters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';
import { inspectLayout } from './layout-probe';
import { runPreview } from './preview-runtime';

vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));
vi.mock('./layout-probe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./layout-probe')>()),
  inspectLayout: vi.fn(),
}));

const chromeAvailable = await findSystemChrome().then(
  () => true,
  () => false,
);
const SOURCE = `function App(){return <main>Hello</main>;} ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`;

describe.skipIf(!chromeAvailable)('a layout measurement that fails or is cancelled', () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'codesign-layout-failure-'));
    await writeFile(join(workspace, 'App.jsx'), SOURCE);
  });
  afterEach(async () => {
    vi.mocked(inspectLayout).mockReset();
    await rm(workspace, { recursive: true, force: true });
  });

  it('is reported by done as a warning and does not fail the run', async () => {
    vi.mocked(inspectLayout).mockRejectedValueOnce(new Error('Execution context was destroyed'));

    const result = await makeRuntimeVerifier({ workspaceRoot: workspace })(SOURCE, {
      path: 'App.jsx',
    });

    expect(result).toEqual({
      errors: [],
      warnings: [
        {
          source: LAYOUT_WARNING_SOURCE,
          message: 'Layout checks did not run: Execution context was destroyed',
        },
      ],
    });
  }, 60_000);

  it('is reported by preview as a warning and does not fail the preview', async () => {
    vi.mocked(inspectLayout).mockRejectedValueOnce(new Error('Execution context was destroyed'));

    const preview = await runPreview({ workspaceRoot: workspace, path: 'App.jsx', vision: false });

    expect(preview.ok).toBe(true);
    expect(preview.layoutIssues).toBeUndefined();
    expect(preview.warnings).toEqual([
      'Layout checks did not run: Execution context was destroyed',
    ]);
  }, 60_000);

  it('carries the notes of a partial measurement into the preview warnings', async () => {
    vi.mocked(inspectLayout).mockResolvedValueOnce({
      issues: [],
      notes: ['Layout checks stopped after 5,000 elements; the rest of the page was not measured.'],
    });

    const preview = await runPreview({ workspaceRoot: workspace, path: 'App.jsx', vision: false });

    expect(preview.ok).toBe(true);
    expect(preview.warnings).toEqual([
      'Layout checks stopped after 5,000 elements; the rest of the page was not measured.',
    ]);
  }, 60_000);

  it('still stops the done verifier when the run was cancelled', async () => {
    const controller = new AbortController();
    vi.mocked(inspectLayout).mockImplementationOnce(async () => {
      controller.abort(new Error('Stopped'));
      throw new Error('Preview cancelled');
    });

    await expect(
      makeRuntimeVerifier({ workspaceRoot: workspace })(SOURCE, {
        path: 'App.jsx',
        signal: controller.signal,
      }),
    ).rejects.toThrow('Stopped');
  }, 60_000);

  it('still stops the preview when the run was cancelled', async () => {
    const controller = new AbortController();
    vi.mocked(inspectLayout).mockImplementationOnce(async () => {
      controller.abort(new Error('Stopped'));
      throw new Error('Preview cancelled');
    });

    const preview = await runPreview({
      workspaceRoot: workspace,
      path: 'App.jsx',
      vision: false,
      signal: controller.signal,
    });

    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe('Preview cancelled');
    expect(preview.warnings).toBeUndefined();
  }, 60_000);
});
