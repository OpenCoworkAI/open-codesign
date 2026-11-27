// @vitest-environment happy-dom
import type { SourceEditElementSnapshot, SourceEditTarget } from '@open-codesign/shared';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementInspector } from './ElementInspector';
import { InspectorRail, PageColorsSection } from './InspectorPanel';
import type { PaletteColor } from './palette';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}(${JSON.stringify(opts)})` : key,
}));

let container: HTMLDivElement;
let root: Root;

const palette: PaletteColor[] = [
  { value: '#294c60', name: 'accent', source: 'token', count: 2 },
  { value: '#10b981', name: 'emerald', source: 'design', count: 1 },
  { value: '#ef4444', name: '', source: 'used', count: 3 },
];

const target: SourceEditTarget = {
  id: '10:90',
  tagName: 'button',
  start: 10,
  end: 90,
  insertionOffset: 17,
  scope: 'source-definition',
  editableFields: [
    { kind: 'set-text', textId: '11:20', value: 'Save' },
    { kind: 'set-text', textId: '30:40', value: ' now' },
    { kind: 'set-style', property: 'color', value: '#294c60' },
    { kind: 'set-style', property: 'fontSize', value: '14px' },
    { kind: 'set-style', property: 'padding', value: '8px 16px' },
    { kind: 'set-attribute', name: 'title', value: 'Submit button' },
  ],
  textSources: [
    { textId: '11:20', start: 11, end: 20, origin: 'JSX text definition' },
    { textId: '30:40', start: 30, end: 40, origin: 'const cta → string literal' },
  ],
  unsupported: [{ field: 'attributes', reason: 'unsafe-source', message: 'Raw handler' }],
};

async function renderNode(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  );
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

describe('ElementInspector', () => {
  it('shows the pick hint and status message when nothing is picked', async () => {
    await renderNode(
      <ElementInspector
        pickedTag={null}
        target={null}
        ancestors={[]}
        busy={false}
        message="Unsupported click"
        palette={palette}
        onApply={vi.fn()}
        onPreview={vi.fn()}
        onSelectAncestor={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('inspector.element.pickHint');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Unsupported click');
  });

  it('groups fields, displays shared/state hints, collapses locks, and runs Ask AI', async () => {
    const onSelectAncestor = vi.fn();
    const onAskAi = vi.fn();
    await renderNode(
      <ElementInspector
        pickedTag="button"
        target={target}
        fieldStates={[
          { key: 'text:11:20', status: 'ready' },
          { key: 'text:30:40', status: 'ready' },
          { key: 'style:color', status: 'ready' },
          { key: 'style:fontSize', status: 'ready' },
          { key: 'style:padding', status: 'ready' },
          { key: 'attribute:title', status: 'changed' },
        ]}
        ancestors={[
          { selector: '/main[1]/section[1]', tagName: 'section' },
          { selector: '/main[1]', tagName: 'main' },
        ]}
        busy={false}
        message={null}
        palette={palette}
        onApply={vi.fn()}
        onPreview={vi.fn()}
        onSelectAncestor={onSelectAncestor}
        onAskAi={onAskAi}
      />,
    );

    expect(container.querySelector('h3')?.textContent).toContain('inspector.kinds.button');
    expect(container.querySelector('h3')?.textContent).toContain('button');
    expect(container.textContent).toContain('inspector.element.shared');
    expect(container.textContent).toContain('canvas.sourceEdit.fieldState.changed');

    const titleInput = container.querySelector<HTMLInputElement>('input[value="Submit button"]');
    expect(titleInput?.disabled).toBe(true);

    const parentChip = container.querySelector<HTMLButtonElement>(
      'button[title="inspector.element.selectParent"]',
    );
    expect(parentChip).not.toBeNull();
    await act(async () => parentChip?.click());
    expect(onSelectAncestor).toHaveBeenCalledWith('/main[1]/section[1]');

    const details = container.querySelectorAll('details');
    expect(details.length).toBeGreaterThanOrEqual(2);
    for (const detail of details) expect(detail.hasAttribute('open')).toBe(false);
    const askAi = buttonWithText('inspector.element.askAi');
    expect(askAi).toBeDefined();
    await act(async () => askAi?.click());
    expect(onAskAi).toHaveBeenCalledOnce();
  });

  it('previews style drafts live, marks used palette chips active, applies only changed fields, and discards cleanly', async () => {
    const onPreview = vi.fn();
    const onApply = vi.fn(async () => {});
    await renderNode(
      <ElementInspector
        pickedTag="button"
        target={target}
        fieldStates={[
          { key: 'text:11:20', status: 'ready' },
          { key: 'text:30:40', status: 'ready' },
          { key: 'style:color', status: 'ready' },
          { key: 'style:fontSize', status: 'ready' },
          { key: 'style:padding', status: 'ready' },
          { key: 'attribute:title', status: 'ready' },
        ]}
        ancestors={[]}
        busy={false}
        message={null}
        palette={palette}
        onApply={onApply}
        onPreview={onPreview}
        onSelectAncestor={vi.fn()}
      />,
    );

    // Initially named token swatch (#294c60 = accent) is pressed and displays '= accent' badge.
    const accentChip = container.querySelector<HTMLButtonElement>('button[aria-label$=": accent"]');
    expect(accentChip?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('inspector.paletteMatch({"name":"accent"})');

    // Picking unnamed 'used' swatch (#ef4444) marks that chip aria-pressed="true" and previews it.
    const usedChip = container.querySelector<HTMLButtonElement>('button[aria-label$=": #ef4444"]');
    await act(async () => usedChip?.click());
    expect(usedChip?.getAttribute('aria-pressed')).toBe('true');
    expect(accentChip?.getAttribute('aria-pressed')).toBe('false');
    expect(onPreview).toHaveBeenLastCalledWith({ styles: { color: '#ef4444' }, attributes: {} });

    // Edit text + length (allow clearing, decimal input, ArrowUp nudge) + box side.
    const textareas = container.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(textareas).toHaveLength(2);
    if (!textareas[0]) throw new Error('Missing first textarea');
    await setInputValue(textareas[0], 'Apply now');

    const fontInput = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    if (!fontInput) throw new Error('Missing fontSize numeric cell');
    await setInputValue(fontInput, '');
    expect(fontInput.value).toBe('');
    await setInputValue(fontInput, '15.5');
    expect(fontInput.value).toBe('15.5');
    await act(async () => {
      fontInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(fontInput.value).toBe('16.5');

    const verticalPadding = container.querySelector<HTMLInputElement>(
      'input[aria-label="inspector.box.vertical"]',
    );
    if (!verticalPadding) throw new Error('Missing box vertical input');
    await setInputValue(verticalPadding, '12');

    // Discard reverts draft and sends empty preview.
    const discard = buttonWithText('inspector.element.discard');
    await act(async () => discard?.click());
    expect(onPreview).toHaveBeenLastCalledWith({ styles: {}, attributes: {} });
    expect(onApply).not.toHaveBeenCalled();

    // Edit again and apply via Ctrl+Enter.
    await act(async () => usedChip?.click());
    await setInputValue(textareas[0], 'Publish');
    const applyButton = buttonWithText('inspector.element.apply');
    expect(applyButton?.disabled).toBe(false);
    await act(async () => {
      container.firstElementChild?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });
    expect(onApply).toHaveBeenCalledWith([
      { kind: 'set-text', textId: '11:20', value: 'Publish' },
      { kind: 'set-style', property: 'color', value: '#ef4444' },
    ]);
  });

  it('shows noDirectEdits, 0 inputs, and Ask AI when picked element has no editable fields (SVG)', async () => {
    const onAskAi = vi.fn();
    const svgTarget: SourceEditTarget = {
      id: '2:20',
      tagName: 'svg',
      start: 2,
      end: 20,
      insertionOffset: 6,
      scope: 'source-definition',
      editableFields: [],
      capabilities: {
        canUpsertStyle: false,
        canUpsertAttribute: false,
        canEditClassName: false,
        canReorderUp: false,
        canReorderDown: false,
        canDuplicate: false,
        canDelete: false,
        sharedDefinition: false,
        styleMode: 'inline',
      },
      unsupported: [],
    };
    await renderNode(
      <ElementInspector
        pickedTag="svg"
        target={svgTarget}
        ancestors={[]}
        busy={false}
        message={null}
        palette={palette}
        onApply={vi.fn()}
        onPreview={vi.fn()}
        onSelectAncestor={vi.fn()}
        onAskAi={onAskAi}
      />,
    );
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(container.textContent).toContain('inspector.kinds.graphic');
    expect(container.textContent).toContain('inspector.element.noDirectEdits');
    expect(container.querySelector('footer')).toBeNull();
    await act(async () => buttonWithText('inspector.element.askAi')?.click());
    expect(onAskAi).toHaveBeenCalledOnce();
  });

  it('supports computed styles, token binding, style reset, child drill-down, undo/redo, and box-model hover', async () => {
    const onApply = vi.fn(async () => {});
    const onPreview = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onSelectAncestor = vi.fn();
    const onHighlightBoxModel = vi.fn();
    const onAskAi = vi.fn();

    const richTarget: SourceEditTarget = {
      id: '10:90',
      tagName: 'div',
      start: 10,
      end: 90,
      insertionOffset: 15,
      scope: 'source-definition',
      editableFields: [
        { kind: 'set-text', value: 'Hero' },
        { kind: 'set-style', property: 'color', value: '#294c60' },
      ],
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: true,
        canReorderUp: true,
        canReorderDown: false,
        canDuplicate: true,
        canDelete: true,
        sharedDefinition: true,
        styleMode: 'tailwind',
      },
      className: 'rounded-lg',
      unsupported: [],
    };
    const snapshot: SourceEditElementSnapshot = {
      computedStyle: {
        color: '#294c60',
        backgroundColor: 'rgb(255, 255, 255)',
        fontSize: '18px',
        padding: '12px',
        margin: '0px',
        opacity: '1',
        display: 'block',
        borderRadius: '8px',
        borderWidth: '0px',
        borderColor: 'rgb(0, 0, 0)',
        boxShadow: 'none',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: '400',
        lineHeight: '24px',
        letterSpacing: '0px',
        textAlign: 'left',
        textTransform: 'none',
        width: '320px',
        height: '120px',
        maxWidth: 'none',
        minHeight: '0px',
        overflow: 'visible',
      },
      boxModel: {
        width: 320,
        height: 120,
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        border: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      instanceCount: 3,
      children: [{ selector: '/div[1]/span[1]', tagName: 'span', textPreview: 'Child' }],
    };

    await renderNode(
      <ElementInspector
        pickedTag="div"
        target={richTarget}
        ancestors={[]}
        elementSnapshot={snapshot}
        busy={false}
        message={null}
        palette={palette}
        canUndo={true}
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onApply={onApply}
        onPreview={onPreview}
        onHighlightBoxModel={onHighlightBoxModel}
        onSelectAncestor={onSelectAncestor}
        onAskAi={onAskAi}
      />,
    );

    // No native <select> exists anywhere in inspector
    expect(container.querySelector('select')).toBeNull();

    // Header shows W x H, Shared badge, Undo/Redo, child drill-down, Ask AI
    expect(container.textContent).toContain(
      'inspector.element.dimensions({"width":320,"height":120})',
    );
    expect(container.textContent).toContain('inspector.element.sharedBadge({"count":3})');
    expect(
      container.querySelector('button[aria-label="inspector.element.askAi"]') ??
        buttonWithText('inspector.element.askAi'),
    ).toBeDefined();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="inspector.element.undo"]')
        ?.click(),
    );
    expect(onUndo).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="inspector.element.redo"]')
        ?.disabled,
    ).toBe(true);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label^="inspector.element.selectChild"]')
        ?.click(),
    );
    expect(onSelectAncestor).toHaveBeenCalledWith('/div[1]/span[1]');

    // Hovering Spacing section calls onHighlightBoxModel
    const spacingSection = Array.from(container.querySelectorAll('section')).find((sec) =>
      sec.textContent?.includes('inspector.groups.spacing'),
    );
    expect(spacingSection).toBeDefined();
    await act(async () => {
      spacingSection?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(onHighlightBoxModel).toHaveBeenCalledWith(true);

    // Live text preview emits draft.texts
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing text field');
    await setInputValue(textarea, 'Updated hero');
    expect(onPreview).toHaveBeenLastCalledWith({
      styles: {},
      attributes: {},
      texts: { only: 'Updated hero' },
    });

    // Bind backgroundColor as tweak token: arm token mode then click accent swatch
    const bindButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="inspector.element.bindToken"]',
    );
    expect(bindButtons.length).toBeGreaterThan(0);
    await act(async () => bindButtons[0]?.click());
    expect(bindButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    const bgAccentChip = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.fields.backgroundColor: accent"]',
    );
    await act(async () => bgAccentChip?.click());
    expect(onPreview).toHaveBeenLastCalledWith({
      styles: { backgroundColor: 'var(--ocd-tweak-accent)' },
      attributes: {},
      texts: { only: 'Updated hero' },
    });

    // Also test slider (opacity), segmented (display -> flex), negative margin, and className
    const opacityInput = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(opacityInput).not.toBeNull();
    if (opacityInput) await setInputValue(opacityInput, '0.8');

    const flexBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.options.display.flex"]',
    );
    expect(flexBtn).not.toBeNull();
    await act(async () => flexBtn?.click());
    // Switching display to flex reveals flexDirection and gap controls
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="inspector.options.flexDirection.column"]',
      ),
    ).not.toBeNull();

    // Expand spacing box from 1 side to 4 sides and set negative margin
    const splitButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="inspector.element.boxUnlink"]',
    );
    expect(splitButtons.length).toBeGreaterThanOrEqual(2);
    await act(async () => splitButtons[1]?.click());
    const topMarginInputs = container.querySelectorAll<HTMLInputElement>(
      'input[aria-label="inspector.box.top"]',
    );
    const marginTopInput = topMarginInputs[topMarginInputs.length - 1];
    if (!marginTopInput) throw new Error('Missing margin top input');
    await setInputValue(marginTopInput, '-12');

    // Typography is open because `color` is authored; verify SelectField works without native <select>
    const typoToggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (btn) => btn.textContent?.includes('inspector.groups.typography'),
    );
    expect(typoToggle?.getAttribute('aria-expanded')).toBe('true');

    const fontWeightTrigger = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="inspector.fields.fontWeight"]',
    );
    expect(fontWeightTrigger).not.toBeNull();
    await act(async () => fontWeightTrigger?.click());
    const boldOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((opt) => opt.textContent?.includes('inspector.options.fontWeight.bold'));
    await act(async () => boldOption?.click());

    // Reset authored color via resetStyle
    const resetBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.resetStyle"]',
    );
    expect(resetBtn).not.toBeNull();
    await act(async () => resetBtn?.click());
    expect(onPreview).toHaveBeenLastCalledWith({
      styles: {
        backgroundColor: 'var(--ocd-tweak-accent)',
        opacity: '0.8',
        fontWeight: '700',
        margin: '-12px 0px 0px 0px',
        display: 'flex',
      },
      removedStyles: ['color'],
      attributes: {},
      texts: { only: 'Updated hero' },
    });

    await act(async () => buttonWithText('inspector.element.apply')?.click());
    expect(onApply).toHaveBeenCalledWith([
      { kind: 'set-text', value: 'Updated hero' },
      { kind: 'set-style', property: 'backgroundColor', value: 'var(--ocd-tweak-accent)' },
      { kind: 'set-style', property: 'opacity', value: '0.8' },
      { kind: 'remove-style', property: 'color' },
      { kind: 'set-style', property: 'fontWeight', value: '700' },
      { kind: 'set-style', property: 'margin', value: '-12px 0px 0px 0px' },
      { kind: 'set-style', property: 'display', value: 'flex' },
    ]);
  });
});

describe('InspectorRail and PageColorsSection', () => {
  it('switches tabs, gates disabled element tab, and collapses to a 40px strip', async () => {
    const onModeChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const onSyncToDesignMd = vi.fn();
    await renderNode(
      <InspectorRail
        mode="page"
        onModeChange={onModeChange}
        elementAvailable={false}
        elementUnavailableReason="Unavailable"
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        page={
          <div>
            page body
            <PageColorsSection palette={palette} onSyncToDesignMd={onSyncToDesignMd} />
          </div>
        }
        element={<div>element body</div>}
      />,
    );

    const tabs = container.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.disabled).toBe(true);
    expect(tabs[1]?.title).toBe('Unavailable');
    expect(container.textContent).toContain('page body');
    expect(container.textContent).toContain('inspector.page.designColors');
    expect(container.textContent).toContain('emerald');
    expect(container.textContent).toContain('inspector.page.usedColors');
    expect(container.textContent).toContain('#ef4444');
    // Tweak tokens belong to TweakPanel, not PageColorsSection.
    expect(container.textContent).not.toContain('accent');

    await act(async () => buttonWithText('inspector.page.syncDesignMd')?.click());
    expect(onSyncToDesignMd).toHaveBeenCalledOnce();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="inspector.collapse"]')
        ?.click(),
    );
    expect(onCollapsedChange).toHaveBeenCalledWith(true);

    await renderNode(
      <InspectorRail
        mode="page"
        onModeChange={onModeChange}
        elementAvailable={true}
        collapsed={true}
        onCollapsedChange={onCollapsedChange}
        page={<div>page</div>}
        element={<div>element</div>}
      />,
    );
    const rail = container.querySelector('aside');
    expect(rail?.className).toContain('w-[40px]');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="inspector.expand"]')?.click(),
    );
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it('omits PageColorsSection when neither DESIGN.md nor used colors exist', async () => {
    await renderNode(<PageColorsSection palette={palette.slice(0, 1)} />);
    expect(container.innerHTML).toBe('');
  });
});
