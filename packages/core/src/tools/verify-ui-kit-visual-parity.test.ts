import { describe, expect, it, vi } from 'vitest';
import type { TextEditorFsCallbacks } from './text-editor.js';
import {
  type JudgeVisualParityFn,
  type RenderUiKitFn,
  STANDARD_VISUAL_PARITY_CHECKS,
  makeVerifyUiKitVisualParityTool,
  visualParityStatusFromChecks,
} from './verify-ui-kit-visual-parity.js';

function makeFs(files: Record<string, string>): TextEditorFsCallbacks {
  return {
    view: (path: string) => {
      const content = files[path];
      if (content === undefined) return null;
      return { content, numLines: content.split('\n').length };
    },
    create: (path: string) => ({ path }),
    strReplace: (path: string) => ({ path }),
    insert: (path: string) => ({ path }),
    listDir: () => [],
  };
}

const SOURCE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const ALL_PASS = STANDARD_VISUAL_PARITY_CHECKS.map((c) => ({
  id: c.id,
  passed: true,
  reason: 'Matches source.',
}));

const ALL_FAIL = STANDARD_VISUAL_PARITY_CHECKS.map((c) => ({
  id: c.id,
  passed: false,
  reason: 'Does not match source.',
}));

const PARTIAL = STANDARD_VISUAL_PARITY_CHECKS.map((c, i) => ({
  id: c.id,
  passed: i % 3 !== 0, // 8 of 12 pass = 0.667
  reason: i % 3 === 0 ? 'Failed: specific element wrong.' : 'Passed.',
}));

describe('visualParityStatusFromChecks', () => {
  it('verified when all pass', () => {
    expect(visualParityStatusFromChecks(12, 12)).toBe('verified');
  });
  it('needs_review when ratio >= 0.85 (e.g. 11/12 or 10/12 boundary)', () => {
    expect(visualParityStatusFromChecks(11, 12)).toBe('needs_review');
    // 0.83 = below 0.85 threshold so falls into needs_iteration
    expect(visualParityStatusFromChecks(10, 12)).toBe('needs_iteration');
  });
  it('needs_iteration in the 0.6-0.85 band', () => {
    // 8/12 = 0.667 -> needs_iteration
    expect(visualParityStatusFromChecks(8, 12)).toBe('needs_iteration');
    // 9/12 = 0.75 -> needs_iteration
    expect(visualParityStatusFromChecks(9, 12)).toBe('needs_iteration');
  });
  it('failed below 0.6', () => {
    // 7/12 = 0.583 -> failed (below 0.6 boundary)
    expect(visualParityStatusFromChecks(7, 12)).toBe('failed');
    expect(visualParityStatusFromChecks(6, 12)).toBe('failed');
    expect(visualParityStatusFromChecks(0, 12)).toBe('failed');
  });
  it('failed when totalChecks is 0', () => {
    expect(visualParityStatusFromChecks(0, 0)).toBe('failed');
  });
});

describe('makeVerifyUiKitVisualParityTool', () => {
  it('returns unavailable when fs is missing', async () => {
    const tool = makeVerifyUiKitVisualParityTool(undefined, undefined, undefined);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('unavailable');
    expect(result.details.summary).toContain('virtual fs not provided');
  });

  it('returns unavailable when renderUiKit callback is missing', async () => {
    const fs = makeFs({});
    const tool = makeVerifyUiKitVisualParityTool(fs, undefined, undefined);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('unavailable');
    expect(result.details.summary).toContain('renderUiKit');
  });

  it('returns unavailable when judgeVisualParity callback is missing', async () => {
    const fs = makeFs({});
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, undefined);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('unavailable');
    expect(result.details.summary).toContain('judgeVisualParity');
  });

  it('returns needs_iteration when decomposed artifact is missing', async () => {
    const fs = makeFs({});
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: ALL_PASS,
      summary: 'ok',
      costUsd: 0,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'never-decomposed' }, undefined);
    expect(result.details.status).toBe('needs_iteration');
    expect(result.details.summary).toContain('missing artifact');
  });

  it('returns verified when all 12 checks pass', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html><body></body>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: ALL_PASS,
      summary: 'High parity.',
      costUsd: 0.05,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('verified');
    expect(result.details.passCount).toBe(12);
    expect(result.details.failCount).toBe(0);
    expect(result.details.parityScore).toBe(1);
    expect(result.details.judgeCostUsd).toBe(0.05);
  });

  it('returns failed when all 12 checks fail', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html><body></body>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: ALL_FAIL,
      summary: 'Low parity.',
      costUsd: 0.05,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('failed');
    expect(result.details.passCount).toBe(0);
    expect(result.details.failCount).toBe(12);
    expect(result.details.parityScore).toBe(0);
  });

  it('returns needs_iteration when 8/12 checks pass (parityScore 0.67)', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html><body></body>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: PARTIAL,
      summary: 'Partial parity.',
      costUsd: 0.05,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('needs_iteration');
    expect(result.details.passCount).toBe(8);
    expect(result.details.failCount).toBe(4);
    expect(result.details.parityScore).toBeCloseTo(0.667, 2);
  });

  it('always emits all 12 standard checks even when judge skips some', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html></html>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    // Judge only answers 3 of the 12 checks
    const partialChecks = ALL_PASS.slice(0, 3);
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: partialChecks,
      summary: 'Partial response.',
      costUsd: 0.05,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.totalChecks).toBe(12);
    expect(result.details.passCount).toBe(3);
    expect(result.details.failCount).toBe(9);
    // The 9 missing checks default to failed with explicit reason
    const unanswered = result.details.checks.filter((c) =>
      c.reason.includes('judge did not answer'),
    );
    expect(unanswered.length).toBe(9);
  });

  it('reports unavailable when source image is missing', async () => {
    const fs = makeFs({ 'ui_kits/x/index.html': '<!doctype html></html>' });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: ALL_PASS,
      summary: '',
      costUsd: 0,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('unavailable');
    expect(result.details.summary).toContain('source image not found');
  });

  it('reports unavailable when source image is not a data URL', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html></html>',
      'source.png': '<not a data url>',
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: ALL_PASS,
      summary: '',
      costUsd: 0,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    expect(result.details.status).toBe('unavailable');
    expect(result.details.summary).toContain('must be a data URL');
  });

  it('threads abort signal to renderUiKit and judgeVisualParity', async () => {
    const controller = new AbortController();
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html></html>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit = vi.fn<RenderUiKitFn>().mockResolvedValue({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity = vi.fn<JudgeVisualParityFn>().mockResolvedValue({
      checks: ALL_PASS,
      summary: '',
      costUsd: 0,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    await tool.execute('t', { slug: 'x' }, controller.signal);
    expect(renderUiKit).toHaveBeenCalledWith(expect.any(String), controller.signal);
    expect(judgeVisualParity).toHaveBeenCalledWith(
      expect.objectContaining({ dataUrl: SOURCE_DATA_URL }),
      expect.objectContaining({ dataUrl: SOURCE_DATA_URL }),
      controller.signal,
    );
  });

  it('every check carries a reason string (HONEST_SCORES rule)', async () => {
    const fs = makeFs({
      'ui_kits/x/index.html': '<!doctype html></html>',
      'source.png': SOURCE_DATA_URL,
    });
    const renderUiKit: RenderUiKitFn = async () => ({
      dataUrl: SOURCE_DATA_URL,
      mediaType: 'image/png',
    });
    const judgeVisualParity: JudgeVisualParityFn = async () => ({
      checks: PARTIAL,
      summary: '',
      costUsd: 0,
    });
    const tool = makeVerifyUiKitVisualParityTool(fs, renderUiKit, judgeVisualParity);
    const result = await tool.execute('t', { slug: 'x' }, undefined);
    for (const check of result.details.checks) {
      expect(check.reason).toBeTruthy();
      expect(check.reason.length).toBeGreaterThan(0);
    }
  });
});
