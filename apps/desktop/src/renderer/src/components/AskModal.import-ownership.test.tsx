// @vitest-environment happy-dom

import { initI18n } from '@open-codesign/i18n';
import type { AskCancelledV1 } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';
import type { AskRequest, WorkspaceImportResult } from '../../../preload';
import { type CodesignState, useCodesignStore } from '../store';
import { AskModal } from './AskModal';

beforeAll(() => initI18n('en'));

function imported(name: string): WorkspaceImportResult {
  return {
    path: `imports/${name}`,
    absolutePath: `C:\\synthetic\\imports\\${name}`,
    name,
    size: 10,
    mediaType: 'text/plain',
    kind: 'reference',
    source: 'composer',
  };
}

it.each(
  [false, true].flatMap((sameSession) =>
    [false, true].flatMap((reject) =>
      [false, true].flatMap((sameBatch) =>
        ['file', 'freeform'].map((secondType) => ({ sameSession, reject, sameBatch, secondType })),
      ),
    ),
  ),
)('isolates cancelled imports and field state: %j', async ({
  sameSession,
  reject,
  sameBatch,
  secondType,
}) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const initial = useCodesignStore.getState();
  let emit!: (request: AskRequest) => void;
  let cancel!: (event: AskCancelledV1) => void;
  let finish!: () => void;
  const imports = vi
    .fn<CodesignState['importFilesToWorkspace']>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          finish = () =>
            reject ? fail(new Error('Old import failed')) : resolve([imported('old.txt')]);
        }),
    )
    .mockResolvedValue([imported('new.txt')]);
  const resolve = vi.fn();
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: {
      ask: {
        pending: async () => [],
        onRequest: (handler: typeof emit) => {
          emit = handler;
          return () => {};
        },
        onCancelled: (handler: typeof cancel) => {
          cancel = handler;
          return () => {};
        },
        resolve,
      },
    },
  });
  useCodesignStore.setState({
    importFilesToWorkspace: imports,
    composerDrafts: { a: 'Keep composer A', b: 'Keep composer B' },
  });
  const request = (requestId: string, sessionId: string): AskRequest => ({
    requestId,
    sessionId,
    input: { questions: [{ id: 'brief', type: 'file', prompt: requestId }] },
  });
  const first = request('First upload', 'a');
  const second = request('Second upload', sameSession ? 'a' : 'b');
  if (secondType === 'freeform') {
    second.input.questions = [{ id: 'brief', type: 'freeform', prompt: 'Second upload' }];
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  async function upload(name: string) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Missing file field');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ path: `C:\\synthetic\\${name}`, name, size: 10 }],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return input;
  }
  try {
    await act(async () => root.render(<AskModal />));
    await act(async () => {
      emit(first);
      emit(second);
    });
    const firstField = await upload('old.txt');
    expect(imports).toHaveBeenCalledOnce();
    await act(async () => {
      cancel({ schemaVersion: 1, requestId: first.requestId, sessionId: first.sessionId });
      if (sameBatch) finish();
    });
    expect(container.textContent).toContain('Second upload');
    expect(container.querySelector('input[type="file"]')).not.toBe(firstField);
    if (secondType === 'file') await upload('new.txt');
    if (!sameBatch) await act(async () => finish());
    expect(container.textContent).not.toContain('old.txt');
    expect(container.textContent).not.toContain('Could not import');
    if (secondType === 'freeform') {
      expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('');
    }
    const answer = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Answer'),
    );
    if (!answer) throw new Error('Missing submit');
    await act(async () => answer.click());
    expect(resolve).toHaveBeenCalledExactlyOnceWith(second.requestId, {
      status: 'answered',
      answers: [{ questionId: 'brief', value: secondType === 'file' ? 'imports/new.txt' : null }],
    });
    expect(useCodesignStore.getState().composerDrafts).toEqual({
      a: 'Keep composer A',
      b: 'Keep composer B',
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    useCodesignStore.setState(initial, true);
    Reflect.deleteProperty(window, 'codesign');
    vi.unstubAllGlobals();
  }
});
