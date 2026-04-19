import { describe, expect, it } from 'vitest';
import { computeAnchoredPosition } from './InlineCommentPopover';

describe('computeAnchoredPosition', () => {
  it('places the popover below the element when there is room', () => {
    const result = computeAnchoredPosition(
      { top: 100, left: 200, width: 80, height: 40 },
      220,
      800,
      1200,
    );
    expect(result.top).toBe(148); // top + height + 8
  });

  it('flips above the element when below would overflow the container', () => {
    const result = computeAnchoredPosition(
      { top: 600, left: 200, width: 80, height: 40 },
      220,
      700,
      1200,
    );
    expect(result.top).toBe(372); // 600 - 220 - 8
  });

  it('clamps the top to the safe gap when flipping above goes off-screen', () => {
    const result = computeAnchoredPosition(
      { top: 50, left: 200, width: 80, height: 40 },
      220,
      90, // tiny container — both below and above overflow
      1200,
    );
    expect(result.top).toBe(8); // clamped to gap
  });

  it('centres horizontally on the element', () => {
    const result = computeAnchoredPosition(
      { top: 100, left: 500, width: 200, height: 40 },
      220,
      800,
      1200,
    );
    // desired = 500 + 100 - 180 = 420
    expect(result.left).toBe(420);
  });

  it('clamps left to the safe gap when the element sits near the left edge', () => {
    const result = computeAnchoredPosition(
      { top: 100, left: 0, width: 40, height: 30 },
      220,
      800,
      1200,
    );
    expect(result.left).toBe(8);
  });

  it('clamps left to keep the popover inside the container right edge', () => {
    // Container 600 wide, element pinned to right side → desired left would
    // overflow. POPOVER_WIDTH=360, GAP=8 → maxLeft = 600 - 360 - 8 = 232.
    const result = computeAnchoredPosition(
      { top: 100, left: 580, width: 20, height: 30 },
      220,
      800,
      600,
    );
    expect(result.left).toBe(232);
  });

  it('places the popover below when container dimensions are unknown', () => {
    const result = computeAnchoredPosition(
      { top: 100, left: 200, width: 80, height: 40 },
      220,
      null,
      null,
    );
    expect(result.top).toBe(148);
  });
});
