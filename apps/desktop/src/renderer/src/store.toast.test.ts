import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const initialState = useCodesignStore.getState();

beforeEach(() => {
  useCodesignStore.setState({ ...initialState, toasts: [], reportableErrors: [] });
});

describe('pushToast error cap', () => {
  it('caps error toasts at 3 and drops the oldest on overflow', () => {
    const { pushToast } = useCodesignStore.getState();
    const firstId = pushToast({ variant: 'error', title: 'first' });
    pushToast({ variant: 'error', title: 'second' });
    pushToast({ variant: 'error', title: 'third' });
    expect(useCodesignStore.getState().toasts.map((t) => t.title)).toEqual([
      'first',
      'second',
      'third',
    ]);

    pushToast({ variant: 'error', title: 'fourth' });

    const after = useCodesignStore.getState().toasts;
    expect(after).toHaveLength(3);
    expect(after.map((t) => t.title)).toEqual(['second', 'third', 'fourth']);
    expect(after.some((t) => t.id === firstId)).toBe(false);
  });

  it('does not drop non-error toasts when an error arrives', () => {
    const { pushToast } = useCodesignStore.getState();
    pushToast({ variant: 'info', title: 'i1' });
    pushToast({ variant: 'success', title: 's1' });
    pushToast({ variant: 'error', title: 'e1' });
    pushToast({ variant: 'error', title: 'e2' });
    pushToast({ variant: 'error', title: 'e3' });
    pushToast({ variant: 'error', title: 'e4' });

    const titles = useCodesignStore.getState().toasts.map((t) => t.title);
    expect(titles).toEqual(['i1', 's1', 'e2', 'e3', 'e4']);
  });

  it('does not cap info or success toasts', () => {
    const { pushToast } = useCodesignStore.getState();
    for (let i = 0; i < 6; i++) {
      pushToast({ variant: 'info', title: `i${i}` });
    }
    expect(useCodesignStore.getState().toasts).toHaveLength(6);
  });
});

describe('reportableErrorToast', () => {
  it('creates a ReportableError with the caller-supplied code/scope and pushes a paired toast', () => {
    vi.stubGlobal('window', { codesign: undefined });
    const id = useCodesignStore.getState().reportableErrorToast({
      code: 'CONNECTION_TEST_FAILED',
      scope: 'settings',
      title: 'Connection failed',
      description: 'HTTP 401',
      context: { provider: 'openai' },
    });
    const state = useCodesignStore.getState();
    const toast = state.toasts.find((t) => t.id === id);
    const record = state.reportableErrors.at(-1);
    expect(toast?.variant).toBe('error');
    expect(toast?.title).toBe('Connection failed');
    expect(toast?.localId).toBe(record?.localId);
    expect(record?.code).toBe('CONNECTION_TEST_FAILED');
    expect(record?.scope).toBe('settings');
    expect(record?.message).toBe('HTTP 401');
    expect(record?.context).toEqual({ provider: 'openai' });
  });

  it('uses title as the message when description is absent', () => {
    vi.stubGlobal('window', { codesign: undefined });
    useCodesignStore.getState().reportableErrorToast({
      code: 'X',
      scope: 'settings',
      title: 'plain',
    });
    const record = useCodesignStore.getState().reportableErrors.at(-1);
    expect(record?.message).toBe('plain');
  });
});
