import { describe, expect, it } from 'vitest';
import type { DesignFileEntry } from './useDesignFiles';
import { previewHtmlFallbackFile, withPreviewHtmlFallback } from './useDesignFiles';

describe('useDesignFiles helpers', () => {
  it('creates a virtual index.html entry from previewHtml', () => {
    expect(previewHtmlFallbackFile('<html>ok</html>', '2026-05-03T00:00:00.000Z')).toEqual({
      path: 'index.html',
      kind: 'html',
      size: 15,
      updatedAt: '2026-05-03T00:00:00.000Z',
      source: 'preview-html',
    });
  });

  it('keeps real workspace files ahead of previewHtml fallback', () => {
    const rows: DesignFileEntry[] = [
      {
        path: 'src/App.tsx',
        kind: 'tsx',
        size: 123,
        updatedAt: '2026-05-03T00:00:00.000Z',
        source: 'workspace',
      },
    ];

    expect(withPreviewHtmlFallback(rows, '<html>fallback</html>')).toBe(rows);
  });

  it('uses previewHtml when the workspace list is empty', () => {
    expect(
      withPreviewHtmlFallback([], '<html>fallback</html>', '2026-05-03T00:00:00.000Z'),
    ).toEqual([
      {
        path: 'index.html',
        kind: 'html',
        size: 21,
        updatedAt: '2026-05-03T00:00:00.000Z',
        source: 'preview-html',
      },
    ]);
  });

  it('returns no files when neither workspace rows nor previewHtml exist', () => {
    expect(withPreviewHtmlFallback([], null)).toEqual([]);
    expect(withPreviewHtmlFallback([], '')).toEqual([]);
  });
});
