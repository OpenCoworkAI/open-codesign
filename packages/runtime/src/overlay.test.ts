import { describe, expect, it, vi } from 'vitest';
import { OVERLAY_SCRIPT } from './overlay';

interface FakeWindow {
  addEventListener: (type: string, fn: unknown, capture?: boolean) => void;
  parent: { postMessage: (msg: unknown, target: string) => void };
  __cs_err?: boolean;
  __cs_rej?: boolean;
  __cs_msg?: boolean;
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

// ---------------------------------------------------------------------------
// SET_MODE trust boundary: control messages must come from window.parent.
// Untrusted in-iframe scripts could synthesise MessageEvent-shaped objects or
// bounce events off the iframe itself (window.postMessage(self, ...)), which
// would arrive with ev.source === window. Both paths must be rejected.
// ---------------------------------------------------------------------------

interface ListenerHarness {
  documentListeners: Map<string, (e: unknown) => void>;
  windowListeners: Map<string, (e: unknown) => void>;
  parent: object;
  postedToParent: unknown[];
}

function runOverlayWithHarness(): ListenerHarness {
  const documentListeners = new Map<string, (e: unknown) => void>();
  const windowListeners = new Map<string, (e: unknown) => void>();
  const postedToParent: unknown[] = [];
  const parent = { postMessage: (msg: unknown) => postedToParent.push(msg) };

  const fakeDocument = {
    body: {},
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      documentListeners.set(type, fn);
    },
    removeEventListener: () => {},
  };
  const fakeWindow = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      windowListeners.set(type, fn);
    },
    parent,
  };
  const fakeSetInterval = () => 1;
  const sandbox = new Function(
    'window',
    'document',
    'console',
    'setInterval',
    `with (window) { ${OVERLAY_SCRIPT} }`,
  );
  sandbox(fakeWindow, fakeDocument, { warn: () => {} }, fakeSetInterval);
  return { documentListeners, windowListeners, parent, postedToParent };
}

describe('OVERLAY_SCRIPT SET_MODE source validation', () => {
  it('drops SET_MODE messages whose source is not window.parent (forged)', () => {
    const h = runOverlayWithHarness();
    const onMessage = h.windowListeners.get('message');
    const onClick = h.documentListeners.get('click');
    expect(onMessage).toBeDefined();
    expect(onClick).toBeDefined();

    // Forged: source is the iframe itself (e.g. window.postMessage(self,...)),
    // not the embedding parent. Even though the envelope looks valid, the
    // mode must NOT switch to 'comment'.
    const forgedSource = {};
    onMessage?.({
      source: forgedSource,
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });

    // currentMode is internal to the IIFE, so we observe via the click gate:
    // in default mode, clicks must not be intercepted (no postMessage to parent).
    onClick?.({
      preventDefault: () => {},
      stopPropagation: () => {},
      target: { tagName: 'DIV', getBoundingClientRect: () => ({}), outerHTML: '<div/>' },
    });
    expect(h.postedToParent).toHaveLength(0);
  });

  it('accepts SET_MODE only when ev.source === window.parent', () => {
    const h = runOverlayWithHarness();
    const onMessage = h.windowListeners.get('message');
    const onClick = h.documentListeners.get('click');

    onMessage?.({
      source: h.parent,
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });

    // Now in comment mode → click should be intercepted and posted to parent.
    onClick?.({
      preventDefault: () => {},
      stopPropagation: () => {},
      target: {
        tagName: 'BUTTON',
        getBoundingClientRect: () => ({ top: 1, left: 2, width: 3, height: 4 }),
        outerHTML: '<button/>',
      },
    });
    expect(h.postedToParent).toHaveLength(1);
    expect((h.postedToParent[0] as { type: string }).type).toBe('ELEMENT_SELECTED');
  });

  it('drops messages with no source (null) even when envelope matches', () => {
    const h = runOverlayWithHarness();
    const onMessage = h.windowListeners.get('message');
    const onClick = h.documentListeners.get('click');

    onMessage?.({
      source: null,
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });

    onClick?.({
      preventDefault: () => {},
      stopPropagation: () => {},
      target: { tagName: 'DIV', getBoundingClientRect: () => ({}), outerHTML: '<div/>' },
    });
    expect(h.postedToParent).toHaveLength(0);
  });
});
