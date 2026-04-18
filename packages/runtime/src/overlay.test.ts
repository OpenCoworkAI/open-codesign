import { describe, expect, it, vi } from 'vitest';
import { OVERLAY_SCRIPT } from './overlay';

interface FakeWindow {
  addEventListener: (type: string, fn: unknown, capture?: boolean) => void;
  parent: { postMessage: (msg: unknown, target: string) => void };
  __cs_err?: boolean;
  __cs_rej?: boolean;
}

function runOverlay(opts: {
  removeThrows?: boolean;
  addThrows?: boolean;
}): { warn: ReturnType<typeof vi.fn>; tick: () => void } {
  const warn = vi.fn();
  const fakeConsole = { warn };

  const fakeDocument = {
    body: {},
    addEventListener: () => {
      if (opts.addThrows) throw new Error('add failed');
    },
    removeEventListener: () => {
      if (opts.removeThrows) throw new Error('remove failed');
    },
  };

  const fakeWindow: FakeWindow = {
    addEventListener: () => {},
    parent: { postMessage: () => {} },
  };

  let intervalFn: (() => void) | null = null;
  const fakeSetInterval = (fn: () => void) => {
    intervalFn = fn;
    return 1;
  };

  const sandbox = new Function(
    'window',
    'document',
    'console',
    'setInterval',
    `with (window) { ${OVERLAY_SCRIPT} }`,
  );
  sandbox(fakeWindow, fakeDocument, fakeConsole, fakeSetInterval);

  return {
    warn,
    tick: () => {
      if (intervalFn) intervalFn();
    },
  };
}

describe('OVERLAY_SCRIPT reattach loop warning throttle', () => {
  it('dedupes repeated reattach failures across many ticks', () => {
    const { warn, tick } = runOverlay({ removeThrows: true, addThrows: true });
    // Initial reattach already ran inside script; simulate 25 more interval fires (~5s @ 200ms).
    for (let i = 0; i < 25; i++) tick();

    // 3 install specs * 2 ops (remove+add) = 6 distinct keys at most.
    // The point: it must not scale with tick count.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('emits at most one warn per unique error key over the whole loop', () => {
    const { warn, tick } = runOverlay({ removeThrows: true });
    for (let i = 0; i < 25; i++) tick();
    const keys = new Set(warn.mock.calls.map((c) => String(c[0])));
    // each warn call should be a unique key
    expect(warn.mock.calls.length).toBe(keys.size);
    // should be ≤ 3 (one per event type), well under the 25-tick spam ceiling
    expect(warn.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
