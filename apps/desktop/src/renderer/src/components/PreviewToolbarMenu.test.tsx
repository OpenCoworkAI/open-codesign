import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PreviewToolbarMenu,
  previewMenuNextIndex,
  previewMenuPosition,
} from './PreviewToolbarMenu';

describe('preview toolbar menu geometry', () => {
  const input = {
    right: 620,
    top: 120,
    bottom: 160,
    width: 320,
    height: 410,
    viewportWidth: 630,
    viewportHeight: 420,
    gap: 8,
  };

  it('keeps a tall menu inside the available space below a narrow-panel trigger', () => {
    expect(previewMenuPosition(input)).toEqual({ left: 300, top: 168, maxHeight: 244 });
  });

  it('opens above a low trigger and clamps its horizontal position', () => {
    expect(previewMenuPosition({ ...input, right: 200, top: 350, bottom: 390 })).toEqual({
      left: 8,
      top: 8,
      maxHeight: 334,
    });
  });

  it('keeps a menu at the right viewport edge within the gutter', () => {
    expect(previewMenuPosition({ ...input, right: 650 }).left).toBe(302);
  });

  it('bounds menus throughout the supported viewport height matrix', () => {
    for (const viewportHeight of [402, 522, 626, 783, 1044]) {
      for (const top of [80, 160, viewportHeight - 48]) {
        const result = previewMenuPosition({ ...input, top, bottom: top + 40, viewportHeight });
        expect(result.top).toBeGreaterThanOrEqual(input.gap);
        expect(result.maxHeight).toBeGreaterThanOrEqual(0);
        expect(result.top + Math.min(input.height, result.maxHeight)).toBeLessThanOrEqual(
          viewportHeight - input.gap,
        );
      }
    }
  });
});

describe('preview toolbar menu navigation', () => {
  it('wraps arrow keys and supports Home and End', () => {
    expect(previewMenuNextIndex('ArrowDown', 4, 5)).toBe(0);
    expect(previewMenuNextIndex('ArrowUp', 0, 5)).toBe(4);
    expect(previewMenuNextIndex('Home', 3, 5)).toBe(0);
    expect(previewMenuNextIndex('End', 1, 5)).toBe(4);
    expect(previewMenuNextIndex('ArrowDown', -1, 5)).toBe(0);
    expect(previewMenuNextIndex('ArrowUp', -1, 5)).toBe(4);
    expect(previewMenuNextIndex('Enter', 2, 5)).toBe(2);
    expect(previewMenuNextIndex('ArrowDown', -1, 0)).toBe(-1);
  });

  it('keeps a named, disabled menu trigger when no preview is available', () => {
    const html = renderToStaticMarkup(
      <PreviewToolbarMenu label="Export" disabled items={[]}>
        Export
      </PreviewToolbarMenu>,
    );
    expect(html).toContain('aria-label="Export"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('role="menu"');
  });
});
