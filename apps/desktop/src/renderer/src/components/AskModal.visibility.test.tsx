// @vitest-environment happy-dom

import { initI18n } from '@open-codesign/i18n';
import type { AskCancelledV1 } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AskRequest } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { AskModal } from './AskModal';

beforeAll(() => initI18n('en'));

afterEach(() => {
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});

describe('clarification visibility in a collapsible sidebar', () => {
  it('dismisses targeted host cancellations across design switches without consent or replay', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const initial = useCodesignStore.getState();
    const resolve = vi.fn();
    const offRequest = vi.fn();
    const offCancelled = vi.fn();
    let emit!: (request: AskRequest) => void;
    let cancel!: (event: AskCancelledV1) => void;
    let replay!: (requests: AskRequest[]) => void;
    const request = (requestId: string, sessionId: string): AskRequest => ({
      requestId,
      sessionId,
      input: {
        questions: [
          { id: 'style', type: 'text-options', prompt: requestId, options: ['Warm', 'Cool'] },
        ],
      },
    });
    const first = request('First question', 'a');
    const queued = request('Queued question', 'b');
    const next = request('New question', 'b');
    Object.defineProperty(window, 'codesign', {
      configurable: true,
      value: {
        ask: {
          onRequest: (handler: typeof emit) => {
            emit = handler;
            return offRequest;
          },
          onCancelled: (handler: typeof cancel) => {
            cancel = handler;
            return offCancelled;
          },
          pending: () =>
            new Promise<AskRequest[]>((done) => {
              replay = done;
            }),
          resolve,
        },
      },
    });
    useCodesignStore.setState({
      currentDesignId: 'a',
      composerDrafts: { a: 'Unsent A', b: 'Unsent B' },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<AskModal />));
      await act(async () => {
        emit(first);
        emit(queued);
        emit(next);
      });
      const choice = container.querySelector<HTMLInputElement>('input[type="radio"]');
      if (!choice) throw new Error('Missing answer option');
      await act(async () => choice.click());
      expect(choice.checked).toBe(true);
      await act(async () => {
        cancel({ schemaVersion: 1, requestId: first.requestId, sessionId: 'wrong-session' });
        cancel({ schemaVersion: 1, requestId: queued.requestId, sessionId: queued.sessionId });
      });
      expect(container.textContent).toContain(first.requestId);
      expect(choice.checked).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
      await act(async () => {
        useCodesignStore.setState({ currentDesignId: 'b' });
        cancel({ schemaVersion: 1, requestId: first.requestId, sessionId: first.sessionId });
        replay([first, queued, next]);
      });
      expect(container.textContent).toContain(next.requestId);
      expect(container.textContent).not.toContain(queued.requestId);
      await act(async () => {
        cancel({ schemaVersion: 1, requestId: first.requestId, sessionId: first.sessionId });
      });
      expect(container.textContent).toContain(next.requestId);
      await act(async () => {
        cancel({ schemaVersion: 1, requestId: next.requestId, sessionId: next.sessionId });
      });
      expect(container.querySelector('section')).toBeNull();
      expect(resolve).not.toHaveBeenCalled();
      expect(useCodesignStore.getState().composerDrafts).toEqual({ a: 'Unsent A', b: 'Unsent B' });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      useCodesignStore.setState(initial, true);
    }
    expect(offRequest).toHaveBeenCalledOnce();
    expect(offCancelled).toHaveBeenCalledOnce();
  });

  it('reveals a new question but does not cancel a hidden question or an IME composition', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const initial = useCodesignStore.getState();
    const revealChat = vi.fn();
    const leaveFullscreen = vi.fn();
    const resolve = vi.fn();
    let emit: ((request: AskRequest) => void) | undefined;
    Object.defineProperty(window, 'codesign', {
      configurable: true,
      value: {
        ask: {
          onRequest: (handler: (request: AskRequest) => void) => {
            emit = handler;
            return () => {};
          },
          pending: async () => [],
          resolve,
        },
      },
    });
    useCodesignStore.setState({
      sidebarCollapsed: true,
      previewFullscreen: true,
      setSidebarCollapsed: revealChat,
      setPreviewFullscreen: leaveFullscreen,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<AskModal />));
      await act(async () => {
        emit?.({
          requestId: 'visibility-question',
          sessionId: 'fixture-design',
          input: { questions: [{ id: 'q1', type: 'freeform', prompt: 'Required information' }] },
        });
      });
      expect(revealChat).toHaveBeenCalledWith(false);
      expect(leaveFullscreen).toHaveBeenCalledWith(false);
      const panel = container.querySelector('section');
      expect(panel).not.toBeNull();
      if (!panel) throw new Error('Missing clarification panel');
      const rectangles = vi.spyOn(panel, 'getClientRects');
      rectangles.mockReturnValue(Object.assign([], { item: () => null }));
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(resolve).not.toHaveBeenCalled();
      const rect = new DOMRect(0, 0, 200, 100);
      rectangles.mockReturnValue(
        Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) }),
      );
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
        const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        consumed.preventDefault();
        window.dispatchEvent(consumed);
      });
      expect(resolve).not.toHaveBeenCalled();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(resolve).toHaveBeenCalledWith('visibility-question', {
        status: 'cancelled',
        answers: [],
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      useCodesignStore.setState(initial, true);
    }
  });
});
