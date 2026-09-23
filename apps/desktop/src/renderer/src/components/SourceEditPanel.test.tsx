// @vitest-environment happy-dom
import type { SourceEditTarget } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceEditPanel } from './SourceEditPanel';

vi.mock('@open-codesign/i18n', () => ({ useT: () => (key: string) => key }));
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
async function mount(busy = false) {
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
      />,
    ),
  );
  return { onApply, onClose };
}
describe('SourceEditPanel', () => {
  it('has all eleven real English and Chinese labels under canvas.sourceEdit', async () => {
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
    ];
    for (const locale of ['en', 'zh-CN'] as const) {
      await setLocale(locale);
      for (const key of keys)
        expect(i18n.exists(`canvas.sourceEdit.${key}`, { lng: locale, fallbackLng: false })).toBe(
          true,
        );
    }
    expect(i18n.t('canvas.sourceEdit.scope')).toContain('源定义');
    await setLocale('en');
    expect(i18n.t('canvas.sourceEdit.reloadWarning')).toContain('reset');
  });
  it('states the definition scope, reload cost and unsupported reasons', async () => {
    await mount();
    expect(container.textContent).toContain('canvas.sourceEdit.scope');
    expect(container.textContent).toContain('canvas.sourceEdit.reloadWarning');
    expect(container.textContent).toContain('Computed styles are not editable (dynamic-style)');
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
