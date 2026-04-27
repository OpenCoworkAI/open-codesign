import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_ASSET_ERRORS,
  MAX_CONSOLE_ENTRIES,
  makePreviewTool,
  type PreviewResult,
} from './preview.js';

function cannedResult(overrides: Partial<PreviewResult> = {}): PreviewResult {
  return {
    ok: true,
    consoleErrors: [],
    assetErrors: [],
    metrics: { nodes: 42, width: 1280, height: 800, loadMs: 120 },
    ...overrides,
  };
}

describe('makePreviewTool', () => {
  it('returns the trimmed preview result verbatim on a clean run', async () => {
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    const tool = makePreviewTool(runPreview);

    const res = await tool.execute('call-1', { path: 'index.html' });

    expect(runPreview).toHaveBeenCalledWith({ path: 'index.html', vision: false });
    expect(res.details.ok).toBe(true);
    expect(res.details.metrics.nodes).toBe(42);
    expect(res.content[0]).toEqual({
      type: 'text',
      text: 'preview ok: 42 nodes, 0 console errors, 0 asset errors',
    });
  });

  it('forwards the vision capability from opts when params omit it', async () => {
    const runPreview = vi.fn().mockResolvedValue(cannedResult());
    const tool = makePreviewTool(runPreview, { vision: true });

    await tool.execute('call-1', { path: 'index.html' });

    expect(runPreview).toHaveBeenCalledWith({ path: 'index.html', vision: true });
  });

  it('caps console and asset arrays to the documented budgets', async () => {
    const fatConsole = Array.from({ length: 100 }, (_, i) => ({
      level: 'error' as const,
      message: `err ${i}`,
    }));
    const fatAssets = Array.from({ length: 50 }, (_, i) => ({
      url: `https://example.com/${i}.png`,
      status: 404,
    }));
    const runPreview = vi.fn().mockResolvedValue(
      cannedResult({
        ok: false,
        consoleErrors: fatConsole,
        assetErrors: fatAssets,
        reason: 'boom',
      }),
    );
    const tool = makePreviewTool(runPreview);

    const res = await tool.execute('call-1', { path: 'index.html' });

    expect(res.details.consoleErrors).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(res.details.consoleErrors).toHaveLength(50);
    expect(res.details.assetErrors).toHaveLength(MAX_ASSET_ERRORS);
    expect(res.details.assetErrors).toHaveLength(20);
    expect(res.details.ok).toBe(false);
    expect(res.content[0]?.type).toBe('text');
  });

  it('throws a tool error when the executor throws', async () => {
    const cause = new Error('iframe crashed');
    const runPreview = vi.fn().mockRejectedValue(cause);
    const tool = makePreviewTool(runPreview);

    const err = await tool
      .execute('call-1', { path: 'index.html' })
      .catch((value: unknown) => value);
    expect(err).toBeInstanceOf(CodesignError);
    expect(err).toMatchObject({
      name: 'CodesignError',
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Preview executor failed: iframe crashed',
    });
    expect((err as CodesignError).cause).toBe(cause);
  });
});
