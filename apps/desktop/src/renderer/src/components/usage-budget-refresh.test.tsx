// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageBudgetResult } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { useDesignUsageBudget } from './usage-budget-refresh';

const initialDesignId = useCodesignStore.getState().currentDesignId;
const initialLastUsage = useCodesignStore.getState().lastUsage;
const initialSettled = useCodesignStore.getState().settledGenerationIds;

function budget(todayTokens: number): UsageBudgetResult {
  const totals = { inputTokens: todayTokens, outputTokens: 0, costUsd: 0 };
  return { schemaVersion: 1, design: totals, today: totals, week: totals };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe({ onError }: { onError: (error: unknown) => void }) {
  const result = useDesignUsageBudget(onError);
  return <output>{result ? String(result.today.inputTokens) : ''}</output>;
}

describe('useDesignUsageBudget', () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 6, 23, 0, 0));
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useCodesignStore.setState({
      currentDesignId: 'design-a',
      lastUsage: null,
      settledGenerationIds: new Set(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useCodesignStore.setState({
      currentDesignId: initialDesignId,
      lastUsage: initialLastUsage,
      settledGenerationIds: initialSettled,
    });
    Reflect.deleteProperty(window, 'codesign');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function shown(): string {
    return container.querySelector('output')?.textContent ?? '';
  }

  it('refetches after a cancelled run settles without changing lastUsage', async () => {
    const usageBudget = vi.fn().mockResolvedValueOnce(budget(1)).mockResolvedValueOnce(budget(4));
    Object.defineProperty(window, 'codesign', { configurable: true, value: { usageBudget } });

    await act(async () => {
      root.render(<Probe onError={vi.fn()} />);
    });
    await flush();
    expect(shown()).toBe('1');

    await act(async () => {
      useCodesignStore.setState((state) => ({
        settledGenerationIds: new Set([...state.settledGenerationIds, 'gen-cancel']),
      }));
    });
    await flush();

    expect(useCodesignStore.getState().lastUsage).toBeNull();
    expect(usageBudget).toHaveBeenCalledTimes(2);
    expect(usageBudget).toHaveBeenNthCalledWith(2, 'design-a');
    expect(shown()).toBe('4');
  });

  it('refetches at the next local midnight and the Monday that starts the week', async () => {
    const usageBudget = vi
      .fn()
      .mockResolvedValueOnce(budget(1))
      .mockResolvedValueOnce(budget(2))
      .mockResolvedValueOnce(budget(3));
    Object.defineProperty(window, 'codesign', { configurable: true, value: { usageBudget } });
    await act(async () => {
      root.render(<Probe onError={vi.fn()} />);
    });
    await flush();
    expect(shown()).toBe('1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    await flush();
    expect(new Date(Date.now()).getDay()).toBe(0);
    expect(shown()).toBe('2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    });
    await flush();
    expect(new Date(Date.now()).getDay()).toBe(1);
    expect(useCodesignStore.getState().lastUsage).toBeNull();
    expect(usageBudget).toHaveBeenCalledTimes(3);
    expect(shown()).toBe('3');
  });

  it('refetches when the window is focused or shown again', async () => {
    const usageBudget = vi.fn(async () => budget(1));
    Object.defineProperty(window, 'codesign', { configurable: true, value: { usageBudget } });
    await act(async () => {
      root.render(<Probe onError={vi.fn()} />);
    });
    await flush();
    expect(usageBudget).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(usageBudget).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(usageBudget).toHaveBeenCalledTimes(3);
  });

  it('ignores a response that resolves after cleanup or after a newer read', async () => {
    const first = deferred<UsageBudgetResult>();
    const second = deferred<UsageBudgetResult>();
    const usageBudget = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(window, 'codesign', { configurable: true, value: { usageBudget } });
    await act(async () => {
      root.render(<Probe onError={vi.fn()} />);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      second.resolve(budget(2));
      await second.promise;
    });
    await flush();
    expect(shown()).toBe('2');

    await act(async () => {
      first.resolve(budget(1));
      await first.promise;
    });
    await flush();
    expect(shown()).toBe('2');

    const late = deferred<UsageBudgetResult>();
    usageBudget.mockReturnValueOnce(late.promise);
    await act(async () => {
      useCodesignStore.setState({ currentDesignId: 'design-b' });
    });
    await act(async () => {
      useCodesignStore.setState({ currentDesignId: null });
    });
    await act(async () => {
      late.resolve(budget(9));
      await late.promise;
    });
    await flush();
    expect(shown()).toBe('');
  });
});
