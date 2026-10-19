// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { DesignSourceControl } from './DesignSourceControl';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', async (original) => ({
  ...(await original<typeof import('@open-codesign/i18n')>()),
  useT: () => translate,
}));
const initial = useCodesignStore.getState();
const revision = '76741943-1171-44b6-a744-a1a3ece68fbc';
const get = vi.fn();
const select = vi.fn();
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: {
      sourceEntry: { get, select },
      files: { list: async () => [{ path: 'pages/new.htm' }, { path: 'assets/logo.svg' }] },
    },
  });
  get.mockReset().mockResolvedValue({
    schemaVersion: 1,
    designId: 'html',
    workspacePath: 'C:/design',
    revision,
    status: 'invalid',
    reason: 'source-missing',
    message: 'The primary source was moved.',
  });
  select.mockReset().mockResolvedValue({
    schemaVersion: 1,
    designId: 'html',
    workspacePath: 'C:/design',
    revision,
    status: 'ready',
    origin: 'declared',
    source: {
      schemaVersion: 1,
      path: 'pages/new.htm',
      format: 'html',
      runtimeMode: 'native-html',
    },
    content: '<main>Recovered</main>',
  });
  useCodesignStore.setState({ ...initial, currentDesignId: 'html' }, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useCodesignStore.setState(initial, true);
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});

it('recovers a moved primary file through explicit selection and the host revision contract', async () => {
  await act(async () => root.render(<DesignSourceControl />));
  expect(container.textContent).toContain('The primary source was moved.');
  const choose = container.querySelector<HTMLButtonElement>('button');
  if (!choose) throw new Error('Missing choose button');
  await act(async () => choose.click());
  const input = container.querySelector('select');
  if (!input) throw new Error('Missing file selector');
  expect([...input.options].map((option) => option.value)).toEqual(['', 'pages/new.htm']);
  await act(async () => {
    input.value = 'pages/new.htm';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(select).toHaveBeenCalledWith({
    schemaVersion: 1,
    designId: 'html',
    path: 'pages/new.htm',
    expectedWorkspacePath: 'C:/design',
    expectedRevision: revision,
  });
  expect(container.textContent).toContain('pages/new.htm');
  expect(useCodesignStore.getState().previewSource).toBe('<main>Recovered</main>');
});

it('disables primary source changes while this design is generating', async () => {
  useCodesignStore.setState({
    generationByDesign: {
      html: { generationId: 'run', stage: 'streaming', startedAt: Date.now() },
    },
  });
  await act(async () => root.render(<DesignSourceControl />));
  expect(container.querySelector('button')?.disabled).toBe(true);
  expect(select).not.toHaveBeenCalled();
});
