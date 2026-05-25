import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setGlobalDispatcherMock, getGlobalDispatcherMock, agentInstances } = vi.hoisted(() => ({
  setGlobalDispatcherMock: vi.fn(),
  getGlobalDispatcherMock: vi.fn(),
  agentInstances: [] as Array<{ connect?: { rejectUnauthorized?: boolean } | undefined }>,
}));

vi.mock('undici', () => {
  class FakeAgent {
    constructor(opts?: { connect?: { rejectUnauthorized?: boolean } }) {
      agentInstances.push({ connect: opts?.connect });
    }
  }
  return {
    Agent: FakeAgent,
    setGlobalDispatcher: (...args: unknown[]) => setGlobalDispatcherMock(...args),
    getGlobalDispatcher: (...args: unknown[]) => getGlobalDispatcherMock(...args),
  };
});

const { loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('./logger', () => ({
  getLogger: () => ({
    warn: loggerWarn,
    error: loggerError,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { _getTlsBypassRefCount, _resetTlsOverrideForTesting, withTlsBypass } from './tls-override';

const ORIGINAL_DISPATCHER = { id: 'original' } as const;

beforeEach(() => {
  _resetTlsOverrideForTesting();
  setGlobalDispatcherMock.mockReset();
  getGlobalDispatcherMock.mockReset();
  loggerWarn.mockReset();
  loggerError.mockReset();
  agentInstances.length = 0;
  getGlobalDispatcherMock.mockReturnValue(ORIGINAL_DISPATCHER);
});

describe('withTlsBypass', () => {
  it('does not touch the dispatcher when disabled', async () => {
    const result = await withTlsBypass(false, async () => 'ok');
    expect(result).toBe('ok');
    expect(setGlobalDispatcherMock).not.toHaveBeenCalled();
    expect(getGlobalDispatcherMock).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
    expect(_getTlsBypassRefCount()).toBe(0);
  });

  it('installs loose dispatcher on first acquire and restores on release', async () => {
    const observed: Array<unknown> = [];
    const result = await withTlsBypass(true, async () => {
      observed.push(setGlobalDispatcherMock.mock.calls.length);
      return 'done';
    });
    expect(result).toBe('done');
    expect(observed[0]).toBe(1);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(2);
    expect(setGlobalDispatcherMock.mock.calls[1]?.[0]).toBe(ORIGINAL_DISPATCHER);
    expect(agentInstances).toHaveLength(1);
    expect(agentInstances[0]?.connect?.rejectUnauthorized).toBe(false);
    expect(_getTlsBypassRefCount()).toBe(0);
  });

  it('reuses the loose dispatcher across nested acquires (swap once, restore once)', async () => {
    await withTlsBypass(true, async () => {
      await withTlsBypass(true, async () => {
        await withTlsBypass(true, async () => {
          expect(_getTlsBypassRefCount()).toBe(3);
        });
        expect(_getTlsBypassRefCount()).toBe(2);
      });
      expect(_getTlsBypassRefCount()).toBe(1);
    });
    expect(_getTlsBypassRefCount()).toBe(0);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(2);
    expect(agentInstances).toHaveLength(1);
  });

  it('restores the dispatcher even when fn throws', async () => {
    await expect(
      withTlsBypass(true, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(_getTlsBypassRefCount()).toBe(0);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(2);
    expect(setGlobalDispatcherMock.mock.calls[1]?.[0]).toBe(ORIGINAL_DISPATCHER);
  });

  it('emits a warn per acquire', async () => {
    await withTlsBypass(true, async () => {
      await withTlsBypass(true, async () => {});
    });
    expect(loggerWarn).toHaveBeenCalledTimes(2);
    expect(loggerWarn.mock.calls[0]?.[0]).toContain('refcount=1');
    expect(loggerWarn.mock.calls[1]?.[0]).toContain('refcount=2');
  });

  it('handles parallel bypass calls — swap on first start, restore after last finishes', async () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };
    const a = deferred<void>();
    const b = deferred<void>();
    const aPromise = withTlsBypass(true, () => a.promise);
    const bPromise = withTlsBypass(true, () => b.promise);
    await Promise.resolve();
    expect(_getTlsBypassRefCount()).toBe(2);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);

    a.resolve();
    await aPromise;
    expect(_getTlsBypassRefCount()).toBe(1);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);

    b.resolve();
    await bPromise;
    expect(_getTlsBypassRefCount()).toBe(0);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(2);
    expect(setGlobalDispatcherMock.mock.calls[1]?.[0]).toBe(ORIGINAL_DISPATCHER);
  });
});
