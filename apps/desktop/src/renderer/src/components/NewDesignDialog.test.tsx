// @vitest-environment happy-dom
import type { Design } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { NewDesignDialog } from './NewDesignDialog';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', async (original) => ({
  ...(await original<typeof import('@open-codesign/i18n')>()),
  useT: () => translate,
}));
const initial = useCodesignStore.getState();
const create = vi.fn();
const pick = vi.fn();
const created: Design = {
  schemaVersion: 1,
  id: 'created',
  name: 'Created',
  createdAt: '',
  updatedAt: '',
  thumbnailText: null,
  deletedAt: null,
  workspacePath: '/created',
};
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { snapshots: { pickWorkspaceFolder: pick } },
  });
  create.mockReset().mockResolvedValue(created);
  pick.mockReset().mockResolvedValue('/existing');
  useCodesignStore.setState(
    { ...initial, newDesignDialogOpen: true, createNewDesign: create },
    true,
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<NewDesignDialog />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useCodesignStore.setState(initial, true);
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});
async function chooseReact() {
  const select = container.querySelector('select');
  if (!select) throw new Error('Missing format selector');
  await act(async () => {
    select.value = 'react';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('defaults to HTML with React under collapsed advanced options', async () => {
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.querySelector('select')?.value).toBe('html');
  expect(container.textContent).toContain('canvas.newDesignDialog.htmlDescription');
  expect(container.textContent).toContain('canvas.newDesignDialog.formatPersistence');
  await submit();
  expect(create).toHaveBeenCalledWith(null, undefined, 'html');
  expect(useCodesignStore.getState().newDesignDialogOpen).toBe(false);
});
it('submits the explicit React choice and describes it', async () => {
  await chooseReact();
  expect(container.textContent).toContain('canvas.newDesignDialog.reactDescription');
  await submit();
  expect(create).toHaveBeenCalledWith(null, undefined, 'react');
});
it('imports a folder without sending a format override or showing a conversion selector', async () => {
  await chooseReact();
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).toContain('canvas.newDesignDialog.existingFormat');
  await submit();
  expect(create).toHaveBeenCalledWith('/existing', undefined, undefined);
});
it('lets an imported folder return to new-design options before creating', async () => {
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  const newFolder = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'canvas.newDesignDialog.skip',
  );
  await act(async () => newFolder?.click());
  expect(create).not.toHaveBeenCalled();
  expect(container.querySelector('select')?.value).toBe('html');
});
it('keeps the chosen format visible when creation fails', async () => {
  create.mockResolvedValue(null);
  await chooseReact();
  await submit();
  expect(useCodesignStore.getState().newDesignDialogOpen).toBe(true);
  expect(container.querySelector('select')?.value).toBe('react');
});
it('starts a fresh dialog with HTML after closing a React selection', async () => {
  await chooseReact();
  await act(async () => useCodesignStore.getState().closeNewDesignDialog());
  await act(async () => useCodesignStore.getState().openNewDesignDialog());
  expect(container.querySelector('select')?.value).toBe('html');
});
