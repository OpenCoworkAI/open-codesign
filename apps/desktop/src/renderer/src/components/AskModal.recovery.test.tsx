// @vitest-environment happy-dom

import { initI18n } from '@open-codesign/i18n';
import type { AskCancelledV1 } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskRequest, AskResolved } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { AskModal, askBelongsToDesign, readAskDraft, removeAskRequest } from './AskModal';

beforeAll(() => initI18n('en'));
const initial = useCodesignStore.getState();
const request = (requestId: string, designId = 'design-a'): AskRequest => ({
  requestId,
  sessionId: `run-${designId}`,
  runId: `run-${designId}`,
  designId,
  input: {
    questions: [
      {
        id: 'shared-id',
        type: 'text-options',
        prompt: `Question ${requestId}`,
        options: ['Warm', 'Cool'],
      },
    ],
  },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let container: HTMLDivElement;
let root: Root;
let emit: (request: AskRequest) => void;
let emitResolved: (event: AskResolved) => void;
let emitCancelled: (event: AskCancelledV1) => void;
let resolveAnswer: ReturnType<typeof vi.fn>;
let pending: ReturnType<typeof vi.fn>;
let history: ReturnType<typeof vi.fn>;
const draft = (id: string) => window.localStorage.getItem(`codesign:ask-draft:${id}`);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  window.localStorage.clear();
  useCodesignStore.setState({ currentDesignId: 'design-a', activeGenerationId: 'run-design-a' });
  resolveAnswer = vi.fn(async () => {});
  pending = vi.fn(async () => []);
  history = vi.fn(async () => []);
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: {
      ask: {
        onRequest: (handler: typeof emit) => {
          emit = handler;
          return () => {};
        },
        onResolved: (handler: typeof emitResolved) => {
          emitResolved = handler;
          return () => {};
        },
        onCancelled: (handler: typeof emitCancelled) => {
          emitCancelled = handler;
          return () => {};
        },
        pending,
        history,
        resolve: resolveAnswer,
      },
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useCodesignStore.setState(initial, true);
  Reflect.deleteProperty(window, 'codesign');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});
async function mount(): Promise<void> {
  await act(async () => root.render(<AskModal />));
}
async function choose(index: number): Promise<void> {
  const input = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[index];
  if (!input) throw new Error('Missing choice');
  await act(async () => input.click());
}
async function submit(): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Answer'),
  );
  if (!button) throw new Error('Missing submit button');
  await act(async () => button.click());
}
function checked(index: number): boolean | undefined {
  return container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[index]?.checked;
}

describe('scoped question recovery', () => {
  it('prefers explicit design identity and supports legacy run-scoped payloads', () => {
    expect(askBelongsToDesign(request('a', 'design-b'), 'design-a', 'run-design-b')).toBe(false);
    const legacy = { requestId: 'legacy', sessionId: 'run-a', input: request('a').input };
    expect(askBelongsToDesign(legacy, 'design-a', 'run-a')).toBe(true);
    expect(askBelongsToDesign(legacy, 'design-b', 'run-b')).toBe(false);
    expect(askBelongsToDesign(legacy, null, 'run-a')).toBe(false);
  });

  it('switches designs without mixing questions or resetting drafts with repeated question IDs', async () => {
    pending.mockResolvedValue([request('a'), request('b', 'design-b')]);
    await mount();
    expect(container.textContent).toContain('Question a');
    await choose(0);
    expect(draft('a')).toContain('Warm');
    await act(async () =>
      useCodesignStore.setState({
        currentDesignId: 'design-b',
        activeGenerationId: 'run-design-b',
      }),
    );
    expect(container.textContent).toContain('Question b');
    expect(checked(0)).toBe(false);
    await choose(1);
    await act(async () =>
      useCodesignStore.setState({
        currentDesignId: 'design-a',
        activeGenerationId: 'run-design-a',
      }),
    );
    expect(checked(0)).toBe(true);
    expect(draft('b')).toContain('Cool');
    await act(async () => emit(request('a')));
    expect(checked(0)).toBe(true);
    expect(resolveAnswer).not.toHaveBeenCalled();
  });

  it('restores drafts after an actual unmount and pending replay', async () => {
    pending.mockResolvedValue([request('a')]);
    await mount();
    await choose(1);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(checked(1)).toBe(true);
    await submit();
    expect(resolveAnswer).toHaveBeenCalledWith('a', {
      status: 'answered',
      answers: [{ questionId: 'shared-id', value: 'Cool' }],
    });
    expect(container.querySelector('section')).toBeNull();
    expect(draft('a')).toBeNull();
  });

  it('retains prompt and draft on submission failure, then clears only after acknowledgement', async () => {
    pending.mockResolvedValue([request('a')]);
    resolveAnswer.mockRejectedValueOnce(new Error('Disk unavailable'));
    await mount();
    await choose(0);
    await submit();
    expect(container.textContent).toContain('Question a');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Disk unavailable');
    expect(checked(0)).toBe(true);
    expect(draft('a')).toContain('Warm');
    const ack = deferred<void>();
    resolveAnswer.mockReturnValueOnce(ack.promise);
    await submit();
    expect(container.textContent).toContain('Question a');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
    await act(async () => ack.resolve());
    expect(container.querySelector('section')).toBeNull();
    expect(draft('a')).toBeNull();
  });

  it('merges live events with delayed recovery and never resurrects remotely resolved questions', async () => {
    const replay = deferred<AskRequest[]>();
    pending.mockReturnValue(replay.promise);
    await mount();
    await act(async () => {
      emit(request('a'));
      emit(request('b'));
    });
    await choose(0);
    await act(async () =>
      emitResolved({ requestId: 'a', sessionId: 'run-design-a', status: 'answered' }),
    );
    expect(container.textContent).toContain('Question b');
    expect(draft('a')).toBeNull();
    await act(async () => replay.resolve([request('a'), request('b'), request('c')]));
    await submit();
    expect(container.textContent).toContain('Question c');
    await submit();
    expect(container.querySelector('section')).toBeNull();
    expect(resolveAnswer).toHaveBeenCalledTimes(2);
  });

  it('removes a remotely resolved queued request without advancing another design', async () => {
    pending.mockResolvedValue([request('a'), request('b', 'design-b')]);
    await mount();
    await act(async () =>
      emitResolved({ requestId: 'b', sessionId: 'run-design-b', status: 'answered' }),
    );
    expect(container.textContent).toContain('Question a');
    expect(
      removeAskRequest({ active: request('a'), queue: [request('b')] }, 'b').active?.requestId,
    ).toBe('a');
    await act(async () => useCodesignStore.setState({ currentDesignId: 'design-b' }));
    expect(container.querySelector('section')).toBeNull();
  });

  it('late acknowledgement for a previous design never removes the current prompt or draft', async () => {
    pending.mockResolvedValue([request('a'), request('b', 'design-b')]);
    const ack = deferred<void>();
    resolveAnswer.mockReturnValueOnce(ack.promise);
    await mount();
    await choose(0);
    await submit();
    await act(async () =>
      useCodesignStore.setState({
        currentDesignId: 'design-b',
        activeGenerationId: 'run-design-b',
      }),
    );
    await choose(1);
    await act(async () => ack.resolve());
    expect(container.textContent).toContain('Question b');
    expect(checked(1)).toBe(true);
    expect(draft('b')).toContain('Cool');
    expect(draft('a')).toBeNull();
  });

  it('cleans interrupted drafts from history without making them actionable', async () => {
    window.localStorage.setItem(
      'codesign:ask-draft:old',
      JSON.stringify({ schemaVersion: 1, answers: { 'shared-id': 'Warm' } }),
    );
    history.mockResolvedValue([{ ...request('old'), status: 'interrupted' }]);
    await mount();
    expect(draft('old')).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows and submits a recovered file path without needing the browser file selection', async () => {
    const fileRequest: AskRequest = {
      ...request('file'),
      input: { questions: [{ id: 'file', type: 'file', prompt: 'Reference image?' }] },
    };
    window.localStorage.setItem(
      'codesign:ask-draft:file',
      JSON.stringify({ schemaVersion: 1, answers: { file: 'references/logo.png' } }),
    );
    pending.mockResolvedValue([fileRequest]);
    await mount();
    expect(container.textContent).toContain('references/logo.png');
    await submit();
    expect(resolveAnswer).toHaveBeenCalledWith('file', {
      status: 'answered',
      answers: [{ questionId: 'file', value: 'references/logo.png' }],
    });
  });
  it('recovers missed requests on focus and removes remotely settled questions even without a resolved event', async () => {
    await mount();
    expect(container.querySelector('section')).toBeNull();
    pending.mockResolvedValue([request('missed')]);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.textContent).toContain('Question missed');
    await choose(0);
    expect(draft('missed')).toContain('Warm');
    pending.mockResolvedValue([]);
    history.mockResolvedValue([{ ...request('missed'), status: 'answered' }]);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('section')).toBeNull();
    expect(draft('missed')).toBeNull();
    expect(resolveAnswer).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    const pendingCalls = pending.mock.calls.length;
    const historyCalls = history.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(pending).toHaveBeenCalledTimes(pendingCalls);
    expect(history).toHaveBeenCalledTimes(historyCalls);
  });

  it('recovers when visible and terminal history blocks an older pending snapshot', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      await mount();
      const delayed = deferred<AskRequest[]>();
      pending.mockReturnValueOnce(delayed.promise);
      history.mockResolvedValue([{ ...request('settled'), status: 'cancelled' }]);
      visibility.mockReturnValue('hidden');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(pending).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(pending).toHaveBeenCalledTimes(2);
      await act(async () => delayed.resolve([request('settled'), request('visible')]));
      expect(container.textContent).toContain('Question visible');
      expect(container.textContent).not.toContain('Question settled');
    } finally {
      visibility.mockRestore();
    }
  });
  it('keeps a draft for mismatched host cancellation and blocks stale same-batch answers for a matched cancellation', async () => {
    pending.mockResolvedValue([request('a'), request('b')]);
    await mount();
    await choose(0);
    await act(async () =>
      emitCancelled({ schemaVersion: 1, requestId: 'a', sessionId: 'wrong-run' }),
    );
    expect(container.textContent).toContain('Question a');
    expect(draft('a')).toContain('Warm');
    const oldSubmit = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Answer'),
    );
    if (!oldSubmit) throw new Error('Missing original submit button');
    await act(async () => {
      emitCancelled({ schemaVersion: 1, requestId: 'a', sessionId: 'run-design-a' });
      oldSubmit.click();
    });
    expect(resolveAnswer).not.toHaveBeenCalled();
    expect(draft('a')).toBeNull();
    expect(container.textContent).toContain('Question b');
  });
  it('ignores malformed and unsupported draft schemas', () => {
    window.localStorage.setItem('codesign:ask-draft:a', '{');
    expect(readAskDraft(request('a'))).toEqual({ 'shared-id': null });
    window.localStorage.setItem(
      'codesign:ask-draft:a',
      JSON.stringify({ schemaVersion: 2, answers: { 'shared-id': 'Warm' } }),
    );
    expect(readAskDraft(request('a'))).toEqual({ 'shared-id': null });
  });
});
