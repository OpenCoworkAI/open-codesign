// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasFloatingToolbar, computeToolbarPosition } from './CanvasFloatingToolbar';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: Root;

async function renderNode(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('CanvasFloatingToolbar', () => {
  it('positions above element by default, flips below near top, and clamps inside container bounds', () => {
    expect(
      computeToolbarPosition({ top: 120, left: 200, width: 100, height: 40 }, 200, 32, 800, 600),
    ).toEqual({ top: 80, left: 150, placement: 'above' });

    expect(
      computeToolbarPosition({ top: 12, left: 10, width: 80, height: 30 }, 200, 32, 800, 600),
    ).toEqual({ top: 50, left: 8, placement: 'below' });

    expect(
      computeToolbarPosition({ top: 560, left: 760, width: 80, height: 40 }, 200, 32, 800, 600),
    ).toEqual({ top: 520, left: 592, placement: 'above' });
  });

  it('renders null when no rect is provided and wires accessible buttons when active', async () => {
    await renderNode(
      <CanvasFloatingToolbar rect={null} containerWidth={800} containerHeight={600} />,
    );
    expect(container.innerHTML).toBe('');

    const onSelectParent = vi.fn();
    const onReorderUp = vi.fn();
    const onReorderDown = vi.fn();
    const onDuplicate = vi.fn();
    const onToggleVisibility = vi.fn();
    const onDelete = vi.fn();
    const onAskAi = vi.fn();

    await renderNode(
      <CanvasFloatingToolbar
        rect={{ top: 100, left: 150, width: 120, height: 40 }}
        containerWidth={800}
        containerHeight={600}
        canSelectParent
        canReorderUp
        canReorderDown={false}
        canDuplicate
        canToggleVisibility
        canDelete
        hidden={false}
        horizontalFlow
        onSelectParent={onSelectParent}
        onReorderUp={onReorderUp}
        onReorderDown={onReorderDown}
        onDuplicate={onDuplicate}
        onToggleVisibility={onToggleVisibility}
        onDelete={onDelete}
        onAskAi={onAskAi}
      />,
    );

    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute('aria-label')).toBe('inspector.element.toolbarLabel');

    const parentBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.selectParent"]',
    );
    const leftBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.moveLeft"]',
    );
    const rightBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.moveRight"]',
    );
    const dupBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.duplicate"]',
    );
    const hideBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.hide"]',
    );
    const delBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.delete"]',
    );
    const aiBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.askAi"]',
    );

    expect(rightBtn?.disabled).toBe(true);
    expect(hideBtn?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      parentBtn?.click();
      leftBtn?.click();
      dupBtn?.click();
      hideBtn?.click();
      delBtn?.click();
      aiBtn?.click();
    });

    expect(onSelectParent).toHaveBeenCalledOnce();
    expect(onReorderUp).toHaveBeenCalledOnce();
    expect(onDuplicate).toHaveBeenCalledOnce();
    expect(onToggleVisibility).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onAskAi).toHaveBeenCalledOnce();
  });
});
