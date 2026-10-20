// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatgptLoginCard } from './ChatgptLoginCard';

const translate = (key: string) => key;
vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));
const pushToast = vi.hoisted(() => vi.fn());
vi.mock('../store', () => ({ useCodesignStore: () => pushToast }));

const loggedOut = { loggedIn: false, email: null, accountId: null, expiresAt: null };
const models = vi.fn();
const login = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  models.mockResolvedValue({ suggestedModel: 'local-account-model', models: ['catalog-model'] });
  login.mockResolvedValue({ ...loggedOut, loggedIn: true });
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { codexOAuth: { status: async () => loggedOut, models, login } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, 'codesign');
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('prefills the local selection and passes it through the actual login button', async () => {
  await act(async () => root.render(<ChatgptLoginCard />));
  expect(container.querySelector('input')?.value).toBe('local-account-model');
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  expect(login).toHaveBeenCalledWith('local-account-model');
});

it('requires a choice instead of silently selecting the first catalog suggestion', async () => {
  models.mockResolvedValue({ suggestedModel: null, models: ['catalog-model'] });
  await act(async () => root.render(<ChatgptLoginCard />));
  expect(container.querySelector('input')?.value).toBe('');
  expect(container.querySelector('button')?.disabled).toBe(true);
  expect(login).not.toHaveBeenCalled();
});
