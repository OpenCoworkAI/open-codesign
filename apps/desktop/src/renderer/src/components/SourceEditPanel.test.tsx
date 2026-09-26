// @vitest-environment happy-dom
import type { SourceEditTarget } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceEditPanel, type SourceEditPanelProps } from './SourceEditPanel';

vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));
let translate = (key: string) => key;
let root: Root;
let container: HTMLDivElement;
const target: SourceEditTarget = {
  id: '1:50',
  tagName: 'p',
  start: 1,
  end: 50,
  insertionOffset: 3,
  scope: 'source-definition',
  editableFields: [
    { kind: 'set-text', value: 'Old' },
    { kind: 'set-attribute', name: 'title', value: 'Title' },
    { kind: 'set-style', property: 'gap', value: '8px' },
  ],
  unsupported: [
    { field: 'style', reason: 'dynamic-style', message: 'Computed styles are not editable' },
  ],
};
beforeEach(() => {
  translate = (key: string) => key;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(busy = false, overrides: Partial<SourceEditPanelProps> = {}) {
  const onApply = vi.fn(async () => {});
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <SourceEditPanel
        path="App.jsx"
        target={target}
        busy={busy}
        message={null}
        onApply={onApply}
        onClose={onClose}
        {...overrides}
      />,
    ),
  );
  return { onApply, onClose };
}
describe('SourceEditPanel', () => {
  it('has real English and Chinese preview-only labels under canvas.sourceEdit', async () => {
    const { i18n, initI18n, setLocale } =
      await vi.importActual<typeof import('@open-codesign/i18n')>('@open-codesign/i18n');
    await initI18n('en');
    const keys = [
      'toggle',
      'title',
      'close',
      'text',
      'apply',
      'scope',
      'reloadWarning',
      'selectHint',
      'unsupportedSelection',
      'saved',
      'unavailable',
      'ancestors',
      'selectAncestor',
      'validationFailed',
      'fieldState.changed',
      'fieldState.ambiguous',
      'fieldState.unmapped',
    ];
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(locale);
      for (const key of keys)
        expect(i18n.exists(`canvas.sourceEdit.${key}`, { lng: locale, fallbackLng: false })).toBe(
          true,
        );
    }
    expect(i18n.t('canvas.sourceEdit.scope')).toContain('所有引用');
    await setLocale('en');
    expect(i18n.t('canvas.sourceEdit.reloadWarning')).toContain('reset');
  });
  it('states the definition scope, reload cost and unsupported reasons', async () => {
    await mount();
    expect(container.textContent).toContain('canvas.sourceEdit.scope');
    expect(container.textContent).toContain('canvas.sourceEdit.reloadWarning');
    expect(container.textContent).not.toContain('Computed styles are not editable');
    expect(container.querySelector('details summary')?.textContent).toBe(
      'canvas.sourceEdit.diagnostics',
    );
    expect(container.querySelector('details code')?.textContent).toBe('dynamic-style');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelectorAll('form')).toHaveLength(3);
  });
  it.each([
    [0, { kind: 'set-text', value: 'New' }],
    [1, { kind: 'set-attribute', name: 'title', value: 'New' }],
    [2, { kind: 'set-style', property: 'gap', value: 'New' }],
  ] as const)('submits only field %s through a native form', async (index, operation) => {
    const { onApply } = await mount();
    const form = container.querySelectorAll('form')[index];
    const input = form?.querySelector('textarea');
    if (!form || !input) throw new Error('Missing field');
    input.value = 'New';
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(onApply).toHaveBeenCalledWith(operation);
  });
  it('shows candidate text fields with friendly labels and independently blocks ambiguous fields', async () => {
    const mixed: SourceEditTarget = {
      ...target,
      textLayout: [{ kind: 'text', textId: '10:15', value: 'Static' }, { kind: 'dynamic' }],
      editableFields: [
        { kind: 'set-text', textId: '10:15', value: 'Static' },
        { kind: 'set-text', textId: '20:25', value: 'Ambiguous' },
      ],
    };
    const { onApply } = await mount(false, {
      target: mixed,
      fieldStates: [
        { key: 'text:10:15', status: 'ready' },
        { key: 'text:20:25', status: 'ambiguous' },
      ],
    });
    expect([...container.querySelectorAll('label')].map((label) => label.textContent)).toEqual([
      'canvas.sourceEdit.text 1',
      'canvas.sourceEdit.text 2',
    ]);
    const fields = container.querySelectorAll('textarea');
    expect(fields[0]?.disabled).toBe(false);
    expect(fields[1]?.disabled).toBe(true);
    expect(container.textContent).toContain('canvas.sourceEdit.fieldState.ambiguous');
    expect(fields[1]?.getAttribute('aria-describedby')).toBeTruthy();
    await act(async () =>
      container
        .querySelectorAll('form')[1]
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).not.toContain('canvas.sourceEdit.chooseSource');
  });
  it('fails closed for production targets lacking runtime states while retaining candidate fields', async () => {
    await mount(false, { target: { ...target, textLayout: [{ kind: 'text', value: 'Old' }] } });
    expect(container.querySelectorAll('form')).toHaveLength(3);
    expect([...container.querySelectorAll('textarea')].every((field) => field.disabled)).toBe(true);
    expect(container.textContent).toContain('canvas.sourceEdit.fieldState.unmapped');
  });
  it('shows readonly source origin and shared-definition warning without a source picker', async () => {
    await mount(false, {
      source: "const title='Old';",
      target: { ...target, textSources: [{ start: 12, end: 17, origin: 'title' }] },
    });
    expect(container.querySelector('pre')?.textContent).toBe("'Old'");
    expect(container.textContent).toContain('canvas.sourceEdit.origin · App.jsx:1');
    expect(container.textContent).not.toContain('App.jsx:1 · title');
    expect(container.textContent).toContain('canvas.sourceEdit.scope');
    expect(container.querySelector('[contenteditable]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });
  it.each([
    'en',
    'zh-CN',
  ] as const)('localizes unsupported fields and source origins in %s without translating code', async (locale) => {
    const { i18n, initI18n } =
      await vi.importActual<typeof import('@open-codesign/i18n')>('@open-codesign/i18n');
    await initI18n(locale);
    translate = (key: string) => String(i18n.t(key, { lng: locale }));
    const rawOrigin = 'const title → string literal (all uses of this definition)';
    await mount(false, {
      source: "const title='Old';",
      target: { ...target, textSources: [{ start: 12, end: 17, origin: rawOrigin }] },
    });
    expect(container.textContent).toContain(translate('canvas.sourceEdit.origin'));
    expect(container.textContent).toContain('App.jsx:1');
    expect(container.querySelector('pre')?.textContent).toBe("'Old'");
    const originDetails = container.querySelectorAll('details')[0];
    expect(originDetails?.open).toBe(false);
    expect(originDetails?.querySelector('code')?.textContent).toBe(rawOrigin);
    const primary = container.cloneNode(true) as HTMLDivElement;
    for (const detail of primary.querySelectorAll('details')) detail.remove();
    expect(primary.textContent).not.toContain(rawOrigin);
    expect(primary.textContent).not.toContain('dynamic-style');
    expect(container.textContent).not.toContain('Computed styles are not editable');
    const details = container.querySelectorAll('details')[1];
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(
      translate('canvas.sourceEdit.diagnostics'),
    );
    expect(details?.querySelector('code')?.textContent).toBe('dynamic-style');
    expect(details?.previousElementSibling?.textContent).toMatch(
      locale === 'zh-CN' ? /[\u4e00-\u9fff]/ : /[A-Za-z]/,
    );
    expect(details?.previousElementSibling?.textContent).not.toContain('dynamic-style');
    expect(container.textContent).not.toContain('canvas.sourceEdit.');
  });
  it('shows ancestor navigation even when the selected element has no source target', async () => {
    const onSelectAncestor = vi.fn();
    await mount(false, {
      target: null,
      ancestors: [{ selector: '/main[1]/button[1]', tagName: 'button' }],
      onSelectAncestor,
    });
    const button = container.querySelector<HTMLButtonElement>('nav button');
    expect(button?.textContent).toBe('<button>');
    await act(async () => button?.click());
    expect(onSelectAncestor).toHaveBeenCalledExactlyOnceWith('/main[1]/button[1]');
    expect(container.querySelector('textarea')).toBeNull();
  });
  it('exits on Escape from a text field but leaves IME composition alone', async () => {
    const { onClose, onApply } = await mount();
    const input = container.querySelector('textarea');
    if (!input) throw new Error('Missing field');
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('disables saving during a request but allows closing', async () => {
    const { onApply, onClose } = await mount(true);
    expect([...container.querySelectorAll('textarea')].every((input) => input.disabled)).toBe(true);
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing field');
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(onApply).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="canvas.sourceEdit.close"]')
        ?.click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
