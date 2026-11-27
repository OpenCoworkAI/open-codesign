import { describe, expect, it, vi } from 'vitest';
import {
  buildOverlayScript,
  isElementRectsMessage,
  isOverlayMessage,
  isSourceEditElementSnapshot,
  isSourceEditHotSwappedMessage,
  isSourceEditInlineEditRequestMessage,
  OVERLAY_SCRIPT,
  SOURCE_EDIT_HUD_ATTRIBUTE,
  SOURCE_EDIT_PREVIEW_STYLE_ID,
} from './overlay';

interface FakeWindow {
  addEventListener: (type: string, fn: unknown, capture?: boolean) => void;
  parent: { postMessage: (msg: unknown, target: string) => void };
  __cs_err?: boolean;
  __cs_rej?: boolean;
  __cs_msg?: boolean;
}

function runOverlay(opts: { removeThrows?: boolean; addThrows?: boolean }): {
  warn: ReturnType<typeof vi.fn>;
  tick: () => void;
} {
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

    // 4 install specs (mouseover/mouseout/click/submit) * 2 ops (remove+add)
    // = 8 distinct keys at most. The point: it must not scale with tick count.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it('emits at most one warn per unique error key over the whole loop', () => {
    const { warn, tick } = runOverlay({ removeThrows: true });
    for (let i = 0; i < 25; i++) tick();
    const keys = new Set(warn.mock.calls.map((c) => String(c[0])));
    // each warn call should be a unique key
    expect(warn.mock.calls.length).toBe(keys.size);
    // should be ≤ 4 (one per install-spec event type), well under the 25-tick spam ceiling
    expect(warn.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// SET_MODE trust boundary: control messages must come from window.parent.
// Untrusted in-iframe scripts could synthesise MessageEvent-shaped objects or
// bounce events off the iframe itself (window.postMessage(self, ...)), which
// would arrive with ev.source === window. Both paths must be rejected.
// ---------------------------------------------------------------------------

interface FakeDomNode {
  tagName: string;
  id: string;
  isConnected: boolean;
  style: Record<string, string>;
  attrs: Record<string, string>;
  className: string;
  children: FakeDomNode[];
  firstChild: FakeDomNode | null;
  firstElementChild: FakeDomNode | null;
  nextElementSibling: FakeDomNode | null;
  parentNode: FakeDomNode | null;
  parentElement: FakeDomNode | null;
  nodeType: number;
  shadowRoot: FakeDomNode | null;
  textContent: string;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, fn: (e: unknown) => void) => void;
  appendChild: (child: FakeDomNode) => FakeDomNode;
  removeChild: (child: FakeDomNode) => FakeDomNode;
  attachShadow: (init: { mode: string }) => FakeDomNode;
  remove: () => void;
}

interface ListenerHarness {
  body: object;
  head: FakeDomNode;
  documentElement: FakeDomNode;
  selectorMatches: Map<string, unknown[]>;
  elementIds: Map<string, unknown>;
  documentListeners: Map<string, (e: unknown) => void>;
  windowListeners: Map<string, (e: unknown) => void>;
  parent: object;
  postedToParent: unknown[];
  setHitTarget: (target: unknown) => void;
  setComputedStyle: (fn: ((el: unknown) => unknown) | null) => void;
  runTick: () => void;
  runRaf: () => void;
  triggerResize: (el?: unknown) => void;
  resizeObservers: Array<{ observed: unknown[]; disconnected: boolean }>;
  queueMutations: (records: object[]) => void;
  fakeWindow: Record<string, unknown>;
  hitLayer: FakeDomNode;
  getHudHost: () => FakeDomNode | null;
  getPreviewStyleEl: () => FakeDomNode | null;
}

function runOverlayWithHarness(script = OVERLAY_SCRIPT): ListenerHarness {
  const body = {};
  const selectorMatches = new Map<string, unknown[]>();
  const elementIds = new Map<string, unknown>();
  const documentListeners = new Map<string, (e: unknown) => void>();
  const windowListeners = new Map<string, (e: unknown) => void>();
  const postedToParent: unknown[] = [];
  const parent = { postMessage: (msg: unknown) => postedToParent.push(msg) };
  let hitTarget: unknown = null;
  let tick = () => {};
  let pendingRaf: (() => void) | null = null;
  let computedStyleFn: ((el: unknown) => unknown) | null = null;
  let hitLayerClaimed = false;
  let hudHost: FakeDomNode | null = null;

  function makeNode(tagName: string): FakeDomNode {
    const attrs: Record<string, string> = {};
    const children: FakeDomNode[] = [];
    let _id = '';
    const listeners = new Map<string, (e: unknown) => void>();
    const node: FakeDomNode = {
      tagName: tagName.toUpperCase(),
      get id() {
        return _id;
      },
      set id(val: string) {
        _id = val;
        if (val) elementIds.set(val, node);
      },
      isConnected: false,
      style: {} as Record<string, string>,
      attrs,
      className: '',
      children,
      get firstChild() {
        return children[0] ?? null;
      },
      get firstElementChild() {
        return children[0] ?? null;
      },
      nextElementSibling: null,
      parentNode: null,
      parentElement: null,
      nodeType: 1,
      shadowRoot: null,
      textContent: '',
      setAttribute(name: string, value: string) {
        attrs[name] = String(value);
        if (name === SOURCE_EDIT_HUD_ATTRIBUTE) hudHost = node;
        if (name === 'id') node.id = String(value);
      },
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      hasAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(attrs, name);
      },
      removeAttribute(name: string) {
        delete attrs[name];
      },
      addEventListener(type: string, fn: (e: unknown) => void) {
        listeners.set(type, fn);
      },
      appendChild(child: FakeDomNode) {
        if (child.parentNode && child.parentNode !== node) {
          child.parentNode.removeChild(child);
        }
        const prev = children.at(-1) ?? null;
        if (prev) prev.nextElementSibling = child;
        child.nextElementSibling = null;
        child.parentNode = node;
        child.parentElement = node;
        child.isConnected = true;
        children.push(child);
        if (child.id) elementIds.set(child.id, child);
        if (Object.prototype.hasOwnProperty.call(child.attrs, SOURCE_EDIT_HUD_ATTRIBUTE)) {
          hudHost = child;
        }
        return child;
      },
      removeChild(child: FakeDomNode) {
        const idx = children.indexOf(child);
        if (idx >= 0) {
          children.splice(idx, 1);
          for (let i = 0; i < children.length; i += 1) {
            const cur = children[i];
            if (cur) cur.nextElementSibling = children[i + 1] ?? null;
          }
        }
        child.parentNode = null;
        child.parentElement = null;
        child.isConnected = false;
        return child;
      },
      attachShadow() {
        const root = makeNode('#shadow-root');
        root.isConnected = true;
        node.shadowRoot = root;
        return root;
      },
      remove() {
        if (node.parentNode) node.parentNode.removeChild(node);
        else node.isConnected = false;
        if (node === hitLayer) hitLayerClaimed = false;
        if (node === hudHost) hudHost = null;
      },
    };
    return node;
  }

  const hitLayer = makeNode('div');
  const head = makeNode('head');
  head.isConnected = true;
  const documentElement = makeNode('html');
  documentElement.isConnected = true;

  const fakeDocument = {
    body,
    head,
    querySelectorAll: (selector: string) => selectorMatches.get(selector) ?? [],
    querySelector: (selector: string) => selectorMatches.get(selector)?.[0] ?? null,
    createElement: (tag: string) => {
      if (tag === 'div' && !hitLayerClaimed) {
        hitLayerClaimed = true;
        return hitLayer;
      }
      return makeNode(tag || 'div');
    },
    documentElement,
    elementFromPoint: () => hitTarget,
    getElementById: (id: string) => elementIds.get(id) ?? null,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      documentListeners.set(type, fn);
    },
    removeEventListener: () => {},
  };
  let mutations: object[] = [];
  class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      const records = mutations;
      mutations = [];
      return records;
    }
  }
  const resizeObservers: Array<{
    cb: () => void;
    observed: unknown[];
    disconnected: boolean;
  }> = [];
  class ResizeObserver {
    private entry: { cb: () => void; observed: unknown[]; disconnected: boolean };
    constructor(cb: () => void) {
      this.entry = { cb, observed: [], disconnected: false };
      resizeObservers.push(this.entry);
    }
    observe(el: unknown) {
      this.entry.observed.push(el);
    }
    disconnect() {
      this.entry.disconnected = true;
    }
  }
  const fakeWindow: Record<string, unknown> = {
    MutationObserver,
    ResizeObserver,
    CSS: { escape: (value: string) => value.replaceAll(':', '\\:') },
    getComputedStyle: (el: unknown) => (computedStyleFn ? computedStyleFn(el) : null),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      windowListeners.set(type, fn);
    },
    requestAnimationFrame: (fn: () => void) => {
      pendingRaf = fn;
      return 1;
    },
    scrollX: 0,
    scrollY: 0,
    scrollTo: vi.fn((x: number, y: number) => {
      fakeWindow['scrollX'] = x;
      fakeWindow['scrollY'] = y;
    }),
    parent,
  };
  const fakeSetInterval = (fn: () => void) => {
    tick = fn;
    return 1;
  };
  const sandbox = new Function(
    'window',
    'document',
    'console',
    'setInterval',
    `with (window) { ${script} }`,
  );
  sandbox(fakeWindow, fakeDocument, { warn: () => {} }, fakeSetInterval);
  return {
    body,
    head,
    documentElement,
    selectorMatches,
    elementIds,
    documentListeners,
    windowListeners,
    parent,
    postedToParent,
    setHitTarget: (target) => {
      hitTarget = target;
    },
    setComputedStyle: (fn) => {
      computedStyleFn = fn;
    },
    runTick: () => tick(),
    runRaf: () => {
      const fn = pendingRaf;
      pendingRaf = null;
      if (fn) fn();
    },
    triggerResize: () => {
      for (const ro of resizeObservers) {
        if (!ro.disconnected) ro.cb();
      }
    },
    resizeObservers,
    queueMutations: (records) => {
      mutations.push(...records);
    },
    fakeWindow,
    hitLayer,
    getHudHost: () => hudHost,
    getPreviewStyleEl: () =>
      (elementIds.get(SOURCE_EDIT_PREVIEW_STYLE_ID) as FakeDomNode | undefined) ?? null,
  };
}

describe('OVERLAY_SCRIPT fragment navigation', () => {
  it.each([
    ['#courses', 'courses'],
    ['#%E8%AF%BE%E7%A8%8B', '课程'],
    ['#invalid%encoding', 'invalid%encoding'],
  ])('scrolls %s locally without following the workspace base URL', (href, id) => {
    const h = runOverlayWithHarness();
    const scrollIntoView = vi.fn();
    h.elementIds.set(id, { scrollIntoView });
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    h.documentListeners.get('click')?.({
      target: {
        tagName: 'SPAN',
        parentElement: {
          tagName: 'A',
          href: `workspace://design/${href}`,
          getAttribute: () => href,
        },
      },
      preventDefault,
      stopPropagation,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it.each([
    '#missing',
    '/missing-page',
    'https://example.com',
  ])('retains the navigation boundary for %s', (href) => {
    const h = runOverlayWithHarness();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    h.documentListeners.get('click')?.({
      target: { tagName: 'A', href, getAttribute: () => href },
      preventDefault,
      stopPropagation,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  function screenDouble(id: string) {
    const attrs: Record<string, string> = { 'data-oc-screen': id };
    return {
      id,
      scrollIntoView: vi.fn(),
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      removeAttribute: (name: string) => {
        delete attrs[name];
      },
    };
  }

  it('shows the targeted data-oc-screen without scrolling or leaving the document', () => {
    const h = runOverlayWithHarness();
    const home = screenDouble('home');
    const pricing = screenDouble('pricing');
    h.elementIds.set('pricing', pricing);
    h.selectorMatches.set('[data-oc-screen]', [h.documentElement, home, pricing]);
    const preventDefault = vi.fn();
    h.documentListeners.get('click')?.({
      target: { tagName: 'A', href: '#pricing', getAttribute: () => '#pricing' },
      preventDefault,
      stopPropagation: vi.fn(),
    });
    expect(h.documentElement.getAttribute('data-oc-active-screen')).toBe('pricing');
    expect(h.documentElement.getAttribute('data-oc-screen')).toBeNull();
    expect(pricing.getAttribute('hidden')).toBeNull();
    expect(home.getAttribute('hidden')).toBe('');
    expect(h.documentElement.getAttribute('hidden')).toBeNull();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pricing.scrollIntoView).not.toHaveBeenCalled();
  });

  it('selects the first screen when the document renders one later', () => {
    const h = runOverlayWithHarness();
    const home = screenDouble('home');
    const pricing = screenDouble('pricing');
    h.selectorMatches.set('[data-oc-screen]', [home, pricing]);
    h.runTick();
    expect(h.documentElement.getAttribute('data-oc-active-screen')).toBe('home');
    expect(home.getAttribute('hidden')).toBeNull();
    expect(pricing.getAttribute('hidden')).toBe('');
  });
});

describe('OVERLAY_SCRIPT fullscreen Escape forwarding', () => {
  it('waits for artifact handlers before forwarding an unconsumed Escape', async () => {
    const harness = runOverlayWithHarness();
    harness.windowListeners.get('keydown')?.({ key: 'Escape' });
    expect(harness.postedToParent).toEqual([]);
    await Promise.resolve();
    expect(harness.postedToParent).toContainEqual({ __codesign: true, type: 'PREVIEW_ESCAPE' });
  });

  it('respects artifact dialogs, IME composition and non-Escape keys', async () => {
    const harness = runOverlayWithHarness();
    const onKey = harness.windowListeners.get('keydown');
    const consumed = { key: 'Escape', defaultPrevented: false };
    onKey?.(consumed);
    consumed.defaultPrevented = true;
    onKey?.({ key: 'Escape', isComposing: true });
    onKey?.({ key: 'Escape', keyCode: 229 });
    onKey?.({ key: 'Enter' });
    await Promise.resolve();
    expect(harness.postedToParent).toEqual([]);
  });
});

describe('OVERLAY_SCRIPT stable clicked targets', () => {
  function select(h: ListenerHarness, target: object) {
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });
    h.documentListeners.get('click')?.({
      preventDefault: () => {},
      stopPropagation: () => {},
      target,
    });
    return h.postedToParent.find(
      (message) => (message as { type: string }).type === 'ELEMENT_SELECTED',
    );
  }
  const element = (parent: object) => ({
    nodeType: 1,
    tagName: 'BUTTON',
    id: 'repeat',
    parentElement: parent,
    previousElementSibling: null as object | null,
    style: { outline: '3px dashed green' },
    outerHTML: '<button id="repeat">Second</button>',
    getBoundingClientRect: () => ({ top: 10, left: 20, width: 100, height: 40 }),
  });
  it('falls back to the exact body path when two elements share an ID', () => {
    const h = runOverlayWithHarness();
    const first = element(h.body);
    const second = { ...element(h.body), previousElementSibling: first };
    h.selectorMatches.set('#repeat', [first, second]);
    expect(select(h, second)).toMatchObject({ selector: '/button[2]' });
  });
  it('uses an escaped ID only when it uniquely identifies the clicked element', () => {
    const h = runOverlayWithHarness();
    const target = { ...element(h.body), id: 'colon:id' };
    h.selectorMatches.set('#colon\\:id', [target]);
    expect(select(h, target)).toMatchObject({ selector: '#colon\\:id' });
  });
  it('restores a pre-existing outline after hover and pin without scrolling a clicked target', () => {
    const h = runOverlayWithHarness();
    const scrollIntoView = vi.fn();
    const target = { ...element(h.body), scrollIntoView };
    select(h, target);
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'CLEAR_PIN' },
    });
    expect(target.style.outline).toBe('3px dashed green');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

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

// ---------------------------------------------------------------------------
// WATCH_SELECTORS + scroll/resize → ELEMENT_RECTS broadcast.
// The iframe owns the source of truth for each pinned element's rect; the
// parent can't observe iframe-internal scroll, so pins drift without this.
// ---------------------------------------------------------------------------

interface RectHarness {
  documentListeners: Map<string, (e: unknown) => void>;
  windowListeners: Map<string, (e: unknown) => void>;
  parent: object;
  postedToParent: Array<Record<string, unknown>>;
  runRaf: () => void;
  registerElement: (selector: string, rect: DOMRect, visible?: boolean) => void;
  registerBodyPath: (selector: string, rect: DOMRect) => void;
}

interface FakeElement {
  tagName: string;
  children: FakeElement[];
  getBoundingClientRect: () => DOMRect;
  scrollIntoView: () => void;
  style: { outline?: string };
  getClientRects?: () => DOMRect[];
}

function runOverlayForRects(): RectHarness {
  const documentListeners = new Map<string, (e: unknown) => void>();
  const windowListeners = new Map<string, (e: unknown) => void>();
  const posted: Array<Record<string, unknown>> = [];
  const parent = { postMessage: (msg: unknown) => posted.push(msg as Record<string, unknown>) };
  const elements = new Map<
    string,
    {
      getBoundingClientRect: () => DOMRect;
      getClientRects?: () => DOMRect[];
      scrollIntoView: () => void;
      style: { outline?: string };
    }
  >();
  const makeElement = (tagName: string, rect = makeRect(0, 0, 0, 0)): FakeElement => ({
    tagName,
    children: [],
    getBoundingClientRect: () => rect,
    scrollIntoView: () => {},
    style: {},
  });
  const body = makeElement('BODY');

  const fakeDocument = {
    body,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      documentListeners.set(type, fn);
    },
    removeEventListener: () => {},
    querySelector: (sel: string) => elements.get(sel) ?? null,
    evaluate: (sel: string) => ({ singleNodeValue: elements.get(sel) ?? null }),
  };
  let pendingRaf: (() => void) | null = null;
  const fakeWindow = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      windowListeners.set(type, fn);
    },
    parent,
    requestAnimationFrame: (fn: () => void) => {
      pendingRaf = fn;
      return 42;
    },
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

  return {
    documentListeners,
    windowListeners,
    parent,
    postedToParent: posted,
    runRaf: () => {
      const fn = pendingRaf;
      pendingRaf = null;
      if (fn) fn();
    },
    registerElement: (selector, rect, visible = true) => {
      elements.set(selector, {
        getBoundingClientRect: () => rect,
        scrollIntoView: () => {},
        style: {},
        getClientRects: () => (visible ? [rect] : []),
      });
    },
    registerBodyPath: (selector, rect) => {
      const parts = selector.slice(1).split('/');
      let current = body;
      for (const part of parts) {
        const match = /^([a-zA-Z][a-zA-Z0-9-]*)\[(\d+)\]$/.exec(part);
        if (!match) throw new Error(`Invalid test selector: ${selector}`);
        const tag = String(match[1]).toUpperCase();
        const index = Number(match[2]);
        let seen = 0;
        let next: FakeElement | undefined;
        for (const child of current.children) {
          if (child.tagName.toUpperCase() === tag) {
            seen += 1;
            if (seen === index) {
              next = child;
              break;
            }
          }
        }
        while (!next) {
          const created = makeElement(tag);
          if (tag === 'SVG' || tag === 'PATH') created.tagName = tag.toLowerCase();
          current.children.push(created);
          seen += 1;
          if (seen === index) next = created;
        }
        current = next;
      }
      current.getBoundingClientRect = () => rect;
    },
  };
}

function makeRect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('selection payload validation', () => {
  const message = {
    __codesign: true,
    type: 'ELEMENT_SELECTED',
    selector: '#target',
    tag: 'button',
    outerHTML: '<button/>',
    rect: { top: 1, left: 2, width: 3, height: 4 },
  };
  it('requires actual element metadata, not just an envelope', () => {
    expect(isOverlayMessage({ __codesign: true, type: 'ELEMENT_SELECTED' })).toBe(false);
    expect(isOverlayMessage(message)).toBe(true);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid sizes %s', (width) => {
    const rect = { ...message.rect, width };
    expect(isOverlayMessage({ ...message, rect })).toBe(false);
    expect(
      isElementRectsMessage({
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: [{ selector: '#target', rect }],
      }),
    ).toBe(false);
  });
});

describe('OVERLAY_SCRIPT rect broadcast', () => {
  it('resolves nested SVG paths using the same case normalization as HTML ancestors', () => {
    const h = runOverlayForRects();
    h.registerBodyPath('/button[2]/svg[1]/path[1]', makeRect(30, 40, 20, 20));
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'WATCH_SELECTORS', selectors: ['/button[2]/svg[1]/path[1]'] },
    });
    h.runRaf();
    expect(h.postedToParent.at(-1)?.['entries']).toEqual([
      {
        selector: '/button[2]/svg[1]/path[1]',
        rect: { top: 30, left: 40, width: 20, height: 20 },
      },
    ]);
  });

  it('reports an empty measured set instead of retaining a hidden layer rectangle', () => {
    const h = runOverlayForRects();
    h.registerElement('#hidden', makeRect(0, 0, 0, 0), false);
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'WATCH_SELECTORS', selectors: ['#hidden'] },
    });
    h.runRaf();
    expect(h.postedToParent.at(-1)).toMatchObject({ type: 'ELEMENT_RECTS', entries: [] });
  });
  it('broadcasts ELEMENT_RECTS after WATCH_SELECTORS message', () => {
    const h = runOverlayForRects();
    h.registerElement('#a', makeRect(10, 20, 30, 40));
    const onMessage = h.windowListeners.get('message');
    onMessage?.({
      source: h.parent,
      data: { __codesign: true, type: 'WATCH_SELECTORS', selectors: ['#a'] },
    });

    h.runRaf();

    const rectMsg = h.postedToParent.find((m) => m['type'] === 'ELEMENT_RECTS');
    expect(rectMsg).toBeDefined();
    const entries = rectMsg?.['entries'] as Array<{
      selector: string;
      rect: Record<string, number>;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      selector: '#a',
      rect: { top: 10, left: 20, width: 30, height: 40 },
    });
  });

  it('re-broadcasts on scroll so pins track the element', () => {
    const h = runOverlayForRects();
    h.registerElement('#a', makeRect(100, 0, 50, 50));

    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'WATCH_SELECTORS', selectors: ['#a'] },
    });
    h.runRaf();
    const firstCount = h.postedToParent.filter((m) => m['type'] === 'ELEMENT_RECTS').length;
    expect(firstCount).toBe(1);

    // Simulate the user scrolling the iframe content: the element's top moved.
    h.registerElement('#a', makeRect(30, 0, 50, 50));
    const onScroll = h.windowListeners.get('scroll');
    expect(onScroll).toBeDefined();
    onScroll?.({});
    h.runRaf();

    const all = h.postedToParent.filter((m) => m['type'] === 'ELEMENT_RECTS');
    expect(all).toHaveLength(2);
    const lastEntries = all[1]?.['entries'] as Array<{ rect: Record<string, number> }>;
    expect(lastEntries[0]?.rect['top']).toBe(30);
  });

  it('coalesces burst of scroll events into one rAF-scheduled broadcast', () => {
    const h = runOverlayForRects();
    h.registerElement('#a', makeRect(0, 0, 1, 1));
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'WATCH_SELECTORS', selectors: ['#a'] },
    });
    h.runRaf(); // initial broadcast from WATCH_SELECTORS

    const onScroll = h.windowListeners.get('scroll');
    onScroll?.({});
    onScroll?.({});
    onScroll?.({});
    h.runRaf();

    const all = h.postedToParent.filter((m) => m['type'] === 'ELEMENT_RECTS');
    // Initial + exactly one from the burst — not three.
    expect(all).toHaveLength(2);
  });

  it('silently skips selectors that do not resolve to elements', () => {
    const h = runOverlayForRects();
    h.registerElement('#live', makeRect(5, 5, 5, 5));
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: {
        __codesign: true,
        type: 'WATCH_SELECTORS',
        selectors: ['#live', '#ghost'],
      },
    });
    h.runRaf();
    const rectMsg = h.postedToParent.find((m) => m['type'] === 'ELEMENT_RECTS');
    const entries = rectMsg?.['entries'] as Array<{ selector: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.selector).toBe('#live');
  });

  it('pins and watches a selector sent from the parent', () => {
    const h = runOverlayForRects();
    h.registerElement('#saved-comment-target', makeRect(12, 24, 48, 96));

    h.windowListeners.get('message')?.({
      source: h.parent,
      data: {
        __codesign: true,
        type: 'PIN_SELECTOR',
        selector: '#saved-comment-target',
      },
    });
    h.runRaf();

    const rectMsg = h.postedToParent.find((m) => m['type'] === 'ELEMENT_RECTS');
    expect(rectMsg).toBeDefined();
    const entries = rectMsg?.['entries'] as Array<{
      selector: string;
      rect: Record<string, number>;
    }>;
    expect(entries[0]).toMatchObject({
      selector: '#saved-comment-target',
      rect: { top: 12, left: 24, width: 48, height: 96 },
    });
  });

  it('resolves body-relative XPath selectors saved by click selection', () => {
    const h = runOverlayForRects();
    h.registerBodyPath('/div[1]/span[1]', makeRect(20, 30, 40, 50));

    h.windowListeners.get('message')?.({
      source: h.parent,
      data: {
        __codesign: true,
        type: 'PIN_SELECTOR',
        selector: '/div[1]/span[1]',
      },
    });
    h.runRaf();

    const rectMsg = h.postedToParent.find((m) => m['type'] === 'ELEMENT_RECTS');
    const entries = rectMsg?.['entries'] as Array<{
      selector: string;
      rect: Record<string, number>;
    }>;
    expect(entries[0]).toMatchObject({
      selector: '/div[1]/span[1]',
      rect: { top: 20, left: 30, width: 40, height: 50 },
    });
  });
});

describe('source provenance selection hints', () => {
  const context = {
    sourceHash: 'a'.repeat(64),
    previewRevision: 'preview-1',
    targets: { '10:50': 'button' },
  };
  function click(
    h: ListenerHarness,
    marker: string | null,
    tagName = 'BUTTON',
    parent?: object,
    childNodes: { nodeType: number; textContent: string }[] = [],
  ) {
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });
    h.documentListeners.get('click')?.({
      preventDefault: () => {},
      stopPropagation: () => {},
      target: {
        nodeType: 1,
        tagName,
        parentElement: parent ?? h.body,
        style: {},
        outerHTML: '<button>Save</button>',
        childNodes,
        getAttribute: (name: string) => (name === 'data-codesign-source-id' ? marker : null),
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 10, height: 10 }),
      },
    });
    return h.postedToParent.at(-1);
  }
  it('emits only the clicked host own known marker and bound revisions', () => {
    const h = runOverlayWithHarness(buildOverlayScript(context));
    const selection = click(h, 'preview-1:10:50');
    expect(selection).toMatchObject({
      sourceEdit: {
        targetId: '10:50',
        sourceHash: context.sourceHash,
        previewRevision: 'preview-1',
      },
    });
    expect(isOverlayMessage(selection)).toBe(true);
  });
  it('validates direct text without consuming icon or emphasized sibling content', () => {
    const h = runOverlayWithHarness(
      buildOverlayScript({ ...context, directTexts: { '10:50': ' Save now' } }),
    );
    expect(
      click(h, 'preview-1:10:50', 'BUTTON', undefined, [
        { nodeType: 1, textContent: 'icon' },
        { nodeType: 3, textContent: ' Save' },
        { nodeType: 8, textContent: 'React separator' },
        { nodeType: 3, textContent: ' now' },
      ]),
    ).toHaveProperty('sourceEdit');
  });
  it.each([
    'Changed by an effect',
    'Save now',
    ' Save now!',
  ])('refuses DOM text changed from the inspected definition: %s', (textContent) => {
    const h = runOverlayWithHarness(
      buildOverlayScript({ ...context, directTexts: { '10:50': ' Save now' } }),
    );
    expect(
      click(h, 'preview-1:10:50', 'BUTTON', undefined, [{ nodeType: 3, textContent }]),
    ).not.toHaveProperty('sourceEdit');
  });
  it('never guesses an ancestor origin or trusts unknown marker/tag pairs', () => {
    for (const [marker, tagName] of [
      [null, 'SPAN'],
      ['preview-1:99:100', 'BUTTON'],
      ['preview-1:10:50', 'DIV'],
    ] as const) {
      const h = runOverlayWithHarness(buildOverlayScript(context));
      const parent = {
        nodeType: 1,
        tagName: 'BUTTON',
        parentElement: h.body,
        getAttribute: () => 'preview-1:10:50',
      };
      expect(click(h, marker, tagName, parent)).not.toHaveProperty('sourceEdit');
    }
  });
  it.each([
    '10:50',
    'author-value',
    'preview-old:10:50',
    'preview-1:99:100',
  ])('ignores authored, stale or unmapped attribute values: %s', (marker) => {
    const h = runOverlayWithHarness(buildOverlayScript(context));
    const selection = click(h, marker);
    expect(isOverlayMessage(selection)).toBe(true);
    expect(selection).not.toHaveProperty('sourceEdit');
  });
  it('does not treat a current-looking marker as provenance without an injected target', () => {
    const h = runOverlayWithHarness(buildOverlayScript({ ...context, targets: {} }));
    expect(click(h, 'preview-1:10:50')).not.toHaveProperty('sourceEdit');
  });
  it('keeps old comments compatible and ignores authored markers without an inspect plan', () => {
    const h = runOverlayWithHarness();
    const selection = click(h, 'preview-1:10:50');
    expect(isOverlayMessage(selection)).toBe(true);
    expect(selection).not.toHaveProperty('sourceEdit');
  });
  it('does not accept a forged parent control message even with a source-edit plan', () => {
    const h = runOverlayWithHarness(buildOverlayScript(context));
    h.windowListeners.get('message')?.({
      source: {},
      data: { __codesign: true, type: 'SET_MODE', mode: 'comment' },
    });
    h.documentListeners.get('click')?.({ target: { tagName: 'BUTTON' } });
    expect(h.postedToParent).toEqual([]);
  });
  it('bounds metadata and existing selection strings', () => {
    const h = runOverlayWithHarness(buildOverlayScript(context));
    const message = click(h, 'preview-1:10:50');
    if (!isOverlayMessage(message)) throw new Error('Missing fixture selection');
    for (const invalid of [
      { ...message, sourceEdit: { ...message.sourceEdit, path: '../outside.jsx' } },
      { ...message, sourceEdit: { ...message.sourceEdit, sourceHash: 'old' } },
      { ...message, selector: 'x'.repeat(8193) },
      { ...message, outerHTML: 'x'.repeat(801) },
      { ...message, parentOuterHTML: 'x'.repeat(601) },
      { ...message, tag: 'x'.repeat(129) },
    ])
      expect(isOverlayMessage(invalid)).toBe(false);
  });
});

describe('unified preview edit selection and validation', () => {
  const sourceHash = 'b'.repeat(64);
  const previewRevision = 'preview-edit';
  function fixture() {
    const h = runOverlayWithHarness(
      buildOverlayScript({
        sourceHash,
        previewRevision,
        targets: { '10:50': 'button' },
        fieldPlans: {
          '10:50': {
            textLayout: [
              { kind: 'text', textId: '11:20', value: 'Cart (' },
              { kind: 'dynamic' },
              { kind: 'text', textId: '30:40', value: ')' },
            ],
            editableFields: [
              { kind: 'set-text', textId: '11:20', value: 'Cart (' },
              { kind: 'set-text', textId: '30:40', value: ')' },
            ],
          },
        },
      }),
    );
    const button = {
      nodeType: 1,
      tagName: 'BUTTON',
      id: 'cart',
      parentElement: h.body,
      style: {},
      isConnected: true,
      outerHTML: '<button disabled>Cart (2)</button>',
      childNodes: [
        { nodeType: 3, textContent: 'Cart (' },
        { nodeType: 3, textContent: '2' },
        { nodeType: 3, textContent: ')' },
      ],
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id' ? 'preview-edit:10:50' : null,
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 30 }),
    };
    h.selectorMatches.set('#cart', [button]);
    h.setHitTarget(button);
    function control(type: string, extra: Record<string, unknown> = {}) {
      h.windowListeners.get('message')?.({
        source: h.parent,
        data: { __codesign: true, type, sourceHash, previewRevision, ...extra },
      });
    }
    control('SET_MODE', { mode: 'source-edit' });
    function pointer() {
      const preventDefault = vi.fn();
      const stopImmediatePropagation = vi.fn();
      h.documentListeners.get('pointerdown')?.({
        type: 'pointerdown',
        clientX: 10,
        clientY: 10,
        preventDefault,
        stopImmediatePropagation,
        target: h.hitLayer,
      });
      return { preventDefault, stopImmediatePropagation };
    }
    return { h, button, control, pointer };
  }
  it('selects disabled hosts via a removable hit layer without dispatching artifact clicks', () => {
    const { h, control, pointer } = fixture();
    expect(h.hitLayer.isConnected).toBe(true);
    const event = pointer();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    const selected = h.postedToParent.at(-1);
    expect(isOverlayMessage(selected)).toBe(true);
    expect(selected).toMatchObject({
      sourceEditRevision: { sourceHash, previewRevision },
      sourceEdit: {
        targetId: '10:50',
        fieldStates: [
          { key: 'text:11:20', status: 'ready' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
    control('SET_MODE', { mode: 'default' });
    expect(h.hitLayer.isConnected).toBe(false);
  });
  it('revalidates the pinned instance immediately before saving and reports DOM changes', () => {
    const { h, button, control, pointer } = fixture();
    pointer();
    const prefixNode = button.childNodes[0];
    if (!prefixNode) throw new Error('Missing text node');
    prefixNode.textContent = 'Changed (';
    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'save-1',
      targetId: '10:50',
      fieldKey: 'text:11:20',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      type: 'SOURCE_EDIT_VALIDATED',
      requestId: 'save-1',
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'changed' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
    h.runTick();
    expect(h.postedToParent.at(-1)).toMatchObject({
      type: 'ELEMENT_SELECTED',
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'changed' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
    button.isConnected = false;
    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'save-2',
      targetId: '10:50',
      fieldKey: 'text:11:20',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      type: 'SOURCE_EDIT_VALIDATED',
      sourceEdit: null,
    });
  });
  it('requires current trusted controls and explicit ancestor navigation', () => {
    const { h, button, control, pointer } = fixture();
    const icon = {
      ...button,
      tagName: 'SVG',
      id: 'icon',
      parentElement: button,
      outerHTML: '<svg/>',
      getAttribute: () => null,
    };
    h.setHitTarget(icon);
    pointer();
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEditAncestors: [{ selector: '#cart', tagName: 'button' }],
      sourceEditRevision: { sourceHash, previewRevision },
    });
    expect(h.postedToParent.at(-1)).not.toHaveProperty('sourceEdit');
    const count = h.postedToParent.length;
    h.windowListeners.get('message')?.({
      source: {},
      data: {
        __codesign: true,
        type: 'SOURCE_EDIT_SELECT',
        selector: '#cart',
        sourceHash,
        previewRevision,
      },
    });
    control('SOURCE_EDIT_SELECT', { selector: '#cart', previewRevision: 'old' });
    control('SOURCE_EDIT_SELECT', { selector: '#elsewhere' });
    expect(h.postedToParent).toHaveLength(count);
    control('SOURCE_EDIT_SELECT', { selector: '#cart' });
    expect(h.postedToParent.at(-1)).toMatchObject({ sourceEdit: { targetId: '10:50' } });
  });
  it('flushes pre-selection removals rather than binding a same-valued dynamic survivor', () => {
    const { h, button, pointer } = fixture();
    const removed = { nodeType: 3, textContent: 'Cart (' };
    // The first surviving node has the same value but came from dynamic content.
    h.queueMutations([
      { type: 'childList', target: button, removedNodes: [removed], addedNodes: [] },
    ]);
    pointer();
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'changed' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
  });
  it('retains original owners when changed text moves before the first observer delivery', () => {
    const { h, button, pointer } = fixture();
    const other = { getAttribute: () => null };
    const changed = { nodeType: 3, textContent: 'Z', parentElement: other };
    h.queueMutations([
      { type: 'characterData', target: changed, oldValue: 'Cart (' },
      { type: 'childList', target: button, removedNodes: [changed], addedNodes: [] },
      { type: 'childList', target: other, removedNodes: [], addedNodes: [changed] },
    ]);
    pointer();
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'changed' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
  });
  it('tracks exact static node identity without poisoning an established dynamic sibling', () => {
    const { h, button, pointer, control } = fixture();
    pointer();
    const dynamicNode = button.childNodes[1];
    const original = button.childNodes[0];
    if (!dynamicNode || !original) throw new Error('Missing fixture text');
    dynamicNode.textContent = 'Cart (';
    Object.assign(dynamicNode, { parentElement: button });
    h.queueMutations([{ type: 'characterData', target: dynamicNode, oldValue: '2' }]);
    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'dynamic',
      targetId: '10:50',
      fieldKey: 'text:11:20',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'ready' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
    button.childNodes[0] = { nodeType: 3, textContent: 'Cart (' };
    h.queueMutations([
      {
        type: 'childList',
        target: button,
        removedNodes: [original],
        addedNodes: [button.childNodes[0]],
      },
    ]);
    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'replacement',
      targetId: '10:50',
      fieldKey: 'text:11:20',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEdit: {
        fieldStates: [
          { key: 'text:11:20', status: 'changed' },
          { key: 'text:30:40', status: 'ready' },
        ],
      },
    });
  });
  it('fails text readiness closed when mutation observation exceeds its budget', () => {
    const { h, button, pointer } = fixture();
    h.queueMutations(
      Array.from({ length: 4097 }, () => ({
        type: 'childList',
        target: button,
        removedNodes: [],
        addedNodes: [],
      })),
    );
    pointer();
    expect(h.postedToParent.at(-1)).toMatchObject({
      sourceEdit: { fieldStates: [{ status: 'unmapped' }, { status: 'unmapped' }] },
    });
  });
  it('bounds new field states, ancestor paths and revisions', () => {
    const { h, pointer } = fixture();
    pointer();
    const message = h.postedToParent.at(-1);
    if (!isOverlayMessage(message)) throw new Error('Missing selection');
    for (const invalid of [
      {
        ...message,
        sourceEdit: {
          ...message.sourceEdit,
          fieldStates: [{ key: 'text:11:20', status: 'approved' }],
        },
      },
      {
        ...message,
        sourceEdit: {
          ...message.sourceEdit,
          fieldStates: [{ key: 'text:11:20', status: 'ready', start: 0 }],
        },
      },
      {
        ...message,
        sourceEdit: {
          ...message.sourceEdit,
          fieldStates: [
            { key: 'text:11:20', status: 'ready' },
            { key: 'text:11:20', status: 'ready' },
          ],
        },
      },
      {
        ...message,
        sourceEditAncestors: Array.from({ length: 17 }, () => ({
          selector: '#cart',
          tagName: 'button',
        })),
      },
      {
        ...message,
        sourceEditAncestors: [{ selector: '#cart', tagName: 'button', sourcePath: '../other.jsx' }],
      },
      { ...message, sourceEditRevision: { sourceHash: 'bad', previewRevision } },
    ])
      expect(isOverlayMessage(invalid)).toBe(false);
  });
});

describe('live source-edit preview and deferred selection restore', () => {
  const sourceHash = 'c'.repeat(64);
  const previewRevision = 'preview-live';

  function createStyleStore(initial: Record<string, string> = {}) {
    const map = new Map<string, { value: string; priority: string }>(
      Object.entries(initial).map(([key, value]) => [key, { value, priority: '' }]),
    );
    return {
      outline: '',
      getPropertyValue: (name: string) => map.get(name)?.value ?? '',
      getPropertyPriority: (name: string) => map.get(name)?.priority ?? '',
      setProperty: (name: string, value: string, priority = '') => {
        map.set(name, { value, priority });
      },
      removeProperty: (name: string) => {
        const prev = map.get(name)?.value ?? '';
        map.delete(name);
        return prev;
      },
    };
  }

  function createStylableElement(h: ListenerHarness) {
    const attrs = new Map<string, string>([
      ['data-codesign-source-id', `${previewRevision}:10:50`],
      ['title', 'Old title'],
    ]);
    const style = createStyleStore({ gap: '12px', color: '#111111' });
    return {
      nodeType: 1,
      tagName: 'BUTTON',
      id: 'cart',
      parentElement: h.body,
      style,
      isConnected: true,
      outerHTML: '<button id="cart" title="Old title">Save</button>',
      childNodes: [{ nodeType: 3, textContent: 'Save' }],
      ownerDocument: { createElement: () => ({ style: createStyleStore() }) },
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, String(value));
      },
      removeAttribute: (name: string) => {
        attrs.delete(name);
      },
      getBoundingClientRect: () => ({ top: 1, left: 2, width: 80, height: 32 }),
    };
  }

  function setup(attachImmediately = true) {
    const h = runOverlayWithHarness(
      buildOverlayScript({
        sourceHash,
        previewRevision,
        targets: { '10:50': 'button' },
        fieldPlans: {
          '10:50': {
            textLayout: [{ kind: 'text', value: 'Save' }],
            editableFields: [
              { kind: 'set-text', value: 'Save' },
              { kind: 'set-style', property: 'gap', value: '12px' },
              { kind: 'set-style', property: 'color', value: '#111111' },
              { kind: 'set-attribute', name: 'title', value: 'Old title' },
            ],
          },
        },
      }),
    );
    const button = createStylableElement(h);
    if (attachImmediately) {
      h.selectorMatches.set('#cart', [button]);
      h.setHitTarget(button);
    }
    function control(
      type: string,
      extra: Record<string, unknown> = {},
      source: unknown = h.parent,
    ) {
      h.windowListeners.get('message')?.({
        source,
        data: { __codesign: true, type, sourceHash, previewRevision, ...extra },
      });
    }
    function clickTarget() {
      h.documentListeners.get('pointerdown')?.({
        type: 'pointerdown',
        clientX: 10,
        clientY: 10,
        preventDefault: () => {},
        stopImmediatePropagation: () => {},
        target: h.hitLayer,
      });
    }
    control('SET_MODE', { mode: 'source-edit' });
    return { h, button, control, clickTarget };
  }

  it('applies allowlisted preview stylesheet, attributes, className, and live texts without breaking validation or reattach, then reverts cleanly', () => {
    const { h, button, control, clickTarget } = setup(true);
    clickTarget();
    h.runRaf();

    // Wrong source, wrong mode or stale revision are ignored.
    control('SOURCE_EDIT_PREVIEW', { styles: { gap: '40' }, attributes: {} }, {});
    control('SOURCE_EDIT_PREVIEW', {
      previewRevision: 'stale',
      styles: { gap: '40' },
      attributes: {},
    });
    expect(h.getPreviewStyleEl()?.textContent ?? '').toBe('');

    control('SOURCE_EDIT_PREVIEW', {
      styles: {
        gap: '24',
        fontSize: '16px',
        color: '#ff0000',
        opacity: '0.5',
        position: 'fixed',
      },
      removedStyles: ['borderRadius'],
      attributes: { title: 'Preview title', onclick: 'evil()' },
      texts: { 'text:only': 'Live Preview' },
      className: 'btn-live',
    });
    const cssText = h.getPreviewStyleEl()?.textContent ?? '';
    expect(cssText).toContain(`[data-codesign-source-id="${previewRevision}:10:50"]`);
    expect(cssText).toContain('gap: 24px !important;');
    expect(cssText).toContain('font-size: 16px !important;');
    expect(cssText).toContain('color: #ff0000 !important;');
    expect(cssText).toContain('opacity: 0.5 !important;');
    expect(cssText).toContain('border-radius: unset !important;');
    expect(cssText).not.toContain('position');
    expect(button.style.getPropertyValue('gap')).toBe('12px');
    expect(button.getAttribute('title')).toBe('Preview title');
    expect(button.getAttribute('onclick')).toBeNull();
    expect(button.getAttribute('class')).toBe('btn-live');
    expect(button.childNodes[0]?.textContent).toBe('Live Preview');
    h.runRaf();
    expect(h.postedToParent.at(-1)).toMatchObject({ type: 'ELEMENT_RECTS' });

    // Reattach tick and commit validation revert around provenance checks, so states stay ready.
    const beforeTick = h.postedToParent.length;
    h.runTick();
    expect(h.postedToParent).toHaveLength(beforeTick);
    expect(button.childNodes[0]?.textContent).toBe('Live Preview');

    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'req-preview-1',
      targetId: '10:50',
      fieldKey: 'text:only',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      type: 'SOURCE_EDIT_VALIDATED',
      requestId: 'req-preview-1',
      sourceEdit: {
        fieldStates: [
          { key: 'text:only', status: 'ready' },
          { key: 'style:gap', status: 'ready' },
          { key: 'style:color', status: 'ready' },
          { key: 'attribute:title', status: 'ready' },
        ],
      },
    });
    expect(button.childNodes[0]?.textContent).toBe('Live Preview');
    expect(h.getPreviewStyleEl()?.textContent).toContain('gap: 24px !important;');

    // Empty draft and CLEAR_PIN both restore the original authored values.
    control('SOURCE_EDIT_PREVIEW', { styles: {}, attributes: {} });
    expect(h.getPreviewStyleEl()?.textContent).toBe('');
    expect(button.style.getPropertyValue('gap')).toBe('12px');
    expect(button.getAttribute('title')).toBe('Old title');
    expect(button.getAttribute('class')).toBeNull();
    expect(button.childNodes[0]?.textContent).toBe('Save');

    control('SOURCE_EDIT_PREVIEW', {
      styles: { gap: '32' },
      attributes: { title: 'Again' },
      texts: { 'text:only': 'Again Text' },
      hidden: true,
    });
    expect(h.getPreviewStyleEl()?.textContent).toContain('display: none !important;');
    expect(button.childNodes[0]?.textContent).toBe('Again Text');
    control('CLEAR_PIN');
    expect(h.getPreviewStyleEl()?.textContent).toBe('');
    expect(button.getAttribute('title')).toBe('Old title');
    expect(button.childNodes[0]?.textContent).toBe('Save');
  });

  it('restores selection immediately or waits across reattach ticks for async React mounts', () => {
    // Immediate restore.
    const immediate = setup(true);
    immediate.control('SOURCE_EDIT_RESTORE', { selector: '#cart' });
    expect(immediate.h.postedToParent.at(-1)).toMatchObject({
      type: 'ELEMENT_SELECTED',
      selector: '#cart',
      sourceEdit: { targetId: '10:50' },
    });

    // Deferred restore until element appears on tick 2.
    const deferredSetup = setup(false);
    const countBefore = deferredSetup.h.postedToParent.length;
    deferredSetup.control('SOURCE_EDIT_RESTORE', { selector: '#cart', previewRevision: 'stale' });
    deferredSetup.control('SOURCE_EDIT_RESTORE', { selector: '#cart', sourceHash: '0'.repeat(64) });
    deferredSetup.control('SOURCE_EDIT_RESTORE', { selector: '#cart' }, {});
    deferredSetup.control('SOURCE_EDIT_RESTORE', { selector: '#cart' });
    deferredSetup.h.runTick();
    expect(deferredSetup.h.postedToParent).toHaveLength(countBefore);

    deferredSetup.h.selectorMatches.set('#cart', [deferredSetup.button]);
    deferredSetup.h.runTick();
    expect(deferredSetup.h.postedToParent.at(-1)).toMatchObject({
      type: 'ELEMENT_SELECTED',
      selector: '#cart',
      sourceEdit: { targetId: '10:50' },
    });

    // Stops polling after 15 unsuccessful ticks.
    const expired = setup(false);
    expired.control('SOURCE_EDIT_RESTORE', { selector: '#cart' });
    for (let i = 0; i < 16; i += 1) expired.h.runTick();
    expired.h.selectorMatches.set('#cart', [expired.button]);
    const beforeLateMount = expired.h.postedToParent.length;
    expired.h.runTick();
    expect(expired.h.postedToParent).toHaveLength(beforeLateMount);
  });
});

describe('Shadow DOM HUD, rich element snapshot, inline edit, ResizeObserver, and hot swap', () => {
  const sourceHash = 'd'.repeat(64);
  const previewRevision = 'preview-v2';

  function richFixture() {
    const h = runOverlayWithHarness(
      buildOverlayScript({
        sourceHash,
        previewRevision,
        targets: { '10:50': 'button', '5:80': 'ul' },
        fieldPlans: {
          '10:50': {
            textLayout: [{ kind: 'text', value: 'Buy now' }],
            editableFields: [
              { kind: 'set-text', value: 'Buy now' },
              { kind: 'set-style', property: 'color', value: 'rgb(10, 20, 30)' },
            ],
          },
        },
        mapSources: {
          '10:50': {
            arrayName: 'items',
            itemCount: 2,
            fields: [{ key: 'label', values: ['Buy now', 'Buy later'] }],
          },
        },
      }),
    );

    const makeCss = (values: Record<string, string>) => ({
      getPropertyValue: (prop: string) => values[prop] ?? '',
    });

    const listWrapper: Record<string, unknown> = {
      nodeType: 1,
      tagName: 'UL',
      id: 'list',
      className: 'flex-col',
      parentElement: h.body,
      children: [] as unknown[],
      outerHTML: '<ul id="list" data-codesign-source-id="preview-v2:5:80"><li>Buy now</li></ul>',
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id'
          ? `${previewRevision}:5:80`
          : name === 'data-codesign-item-index'
            ? '1'
            : null,
    };

    const childSpan = {
      nodeType: 1,
      tagName: 'SPAN',
      textContent: 'Badge',
      parentElement: null as unknown,
      previousElementSibling: null as unknown,
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id' ? `${previewRevision}:10:50` : null,
    };

    const button = {
      nodeType: 1,
      tagName: 'BUTTON',
      id: 'cta',
      className: 'primary-btn',
      parentElement: listWrapper,
      previousElementSibling: null as unknown,
      children: [childSpan],
      style: { outline: '' },
      isConnected: true,
      outerHTML:
        '<button id="cta" data-codesign-source-id="preview-v2:10:50" data-codesign-item-index="1">Buy now</button>',
      childNodes: [{ nodeType: 3, textContent: 'Buy now' }],
      ownerDocument: {
        createElement: () => ({
          style: {
            setProperty: () => {},
            getPropertyValue: () => '',
          },
        }),
      },
      getAttribute: (name: string) => {
        if (name === 'data-codesign-source-id') return `${previewRevision}:10:50`;
        if (name === 'data-codesign-item-index') return '1';
        if (name === 'class') return 'primary-btn';
        if (name === 'href') return 'https://example.com';
        return null;
      },
      getBoundingClientRect: () => ({ top: 8, left: 16, width: 120, height: 36 }),
    };
    childSpan.parentElement = button;

    const buttonClone = {
      ...button,
      id: 'cta-2',
      previousElementSibling: button,
      isConnected: true,
      getBoundingClientRect: () => ({ top: 64, left: 16, width: 120, height: 36 }),
    };
    listWrapper['children'] = [button, buttonClone];

    h.selectorMatches.set('#cta', [button]);
    h.selectorMatches.set('#cta-2', [buttonClone]);
    h.selectorMatches.set(`[data-codesign-source-id="${previewRevision}:10:50"]`, [
      button,
      buttonClone,
    ]);
    h.setComputedStyle((el) => {
      if (el === listWrapper) return makeCss({ display: 'flex', 'flex-direction': 'column' });
      if (el === button) {
        return makeCss({
          color: 'rgb(10, 20, 30)',
          'font-size': '14px',
          'font-family': 'Inter',
          'padding-top': '8px',
          'padding-right': '12px',
          'padding-bottom': '8px',
          'padding-left': '12px',
          'margin-top': '4px',
          'margin-right': '0px',
          'margin-bottom': '4px',
          'margin-left': '0px',
          'border-top-width': '1px',
          'border-right-width': '1px',
          'border-bottom-width': '1px',
          'border-left-width': '1px',
        });
      }
      return null;
    });

    h.setHitTarget(button);
    const control = (type: string, extra: Record<string, unknown> = {}) => {
      h.windowListeners.get('message')?.({
        source: h.parent,
        data: { __codesign: true, type, sourceHash, previewRevision, ...extra },
      });
    };
    control('SET_MODE', { mode: 'source-edit' });
    return { h, button, buttonClone, listWrapper, control };
  }

  it('collects bounded elementSnapshot and strips synthetic attributes from outerHTML and parentOuterHTML', () => {
    const { h, button, control } = richFixture();
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 20,
      clientY: 20,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    const selected = h.postedToParent.at(-1) as Record<string, unknown>;
    expect(isOverlayMessage(selected)).toBe(true);
    expect(selected['outerHTML']).not.toContain('data-codesign-source-id');
    expect(selected['outerHTML']).not.toContain('data-codesign-item-index');
    expect(selected['parentOuterHTML']).not.toContain('data-codesign-source-id');
    expect(isSourceEditElementSnapshot(selected['elementSnapshot'])).toBe(true);
    expect(selected['elementSnapshot']).toMatchObject({
      computedStyle: { color: 'rgb(10, 20, 30)', fontSize: '14px', fontFamily: 'Inter' },
      boxModel: {
        width: 120,
        height: 36,
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
        margin: { top: 4, right: 0, bottom: 4, left: 0 },
        border: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      instanceCount: 2,
      itemIndex: 1,
      parentLayout: { display: 'flex', flexDirection: 'column' },
      siblingIndex: 0,
      siblingCount: 2,
      children: [{ tagName: 'span', textPreview: 'Badge', targetId: '10:50' }],
      elementMeta: { className: 'primary-btn', id: 'cta', href: 'https://example.com' },
    });
    expect(button.style.outline).toBe('');
    control('SET_MODE', { mode: 'default' });
  });

  it('renders Shadow DOM HUD boxes, clamped dimension pill, secondary instances, and box model bands without touching textObserver', () => {
    const { h, button, buttonClone, control } = richFixture();
    const hud = h.getHudHost();
    expect(hud).not.toBeNull();
    expect(hud?.getAttribute(SOURCE_EDIT_HUD_ATTRIBUTE)).toBe('');
    expect(hud?.shadowRoot).not.toBeNull();

    // Hover renders hover box without touching el.style.outline.
    h.setHitTarget(buttonClone);
    h.documentListeners.get('pointermove')?.({ type: 'pointermove', clientX: 20, clientY: 70 });
    const layer = hud?.shadowRoot?.children[1];
    expect(layer?.children.some((node) => node.className === 'box hover')).toBe(true);
    expect(buttonClone.style.outline).toBe('');

    // Select button at top: 8 -> pill top clamps to 0px, renders primary + secondary dashed instance.
    h.setHitTarget(button);
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 20,
      clientY: 12,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    expect(layer?.children.some((node) => node.className === 'box pinned')).toBe(true);
    expect(layer?.children.some((node) => node.className === 'box instance')).toBe(true);
    const pill = layer?.children.find((node) => node.className === 'pill');
    expect(pill?.textContent).toBe('button · 120×36');
    expect(pill?.style['top']).toBe('0px');

    // Box model bands toggle via SOURCE_EDIT_HUD_STATE.
    control('SOURCE_EDIT_HUD_STATE', { highlightBoxModel: true });
    expect(layer?.children.some((node) => node.className === 'margin-band')).toBe(true);
    expect(layer?.children.some((node) => node.className === 'padding-band')).toBe(true);

    // Flood textObserver with HUD / preview style mutations (> 4096); text fields must stay ready!
    const previewStyle = h.getPreviewStyleEl();
    h.queueMutations(
      Array.from({ length: 4200 }, () => ({
        type: 'childList',
        target: hud as object,
        removedNodes: [{ nodeType: 3, textContent: 'hud' }],
        addedNodes: [{ nodeType: 1, firstElementChild: null, nextElementSibling: null }],
      })),
    );
    if (previewStyle) {
      h.queueMutations([
        {
          type: 'childList',
          target: previewStyle,
          removedNodes: [],
          addedNodes: [],
        },
      ]);
    }
    control('SOURCE_EDIT_VALIDATE', {
      requestId: 'hud-isolation',
      targetId: '10:50',
      fieldKey: 'text:only',
    });
    expect(h.postedToParent.at(-1)).toMatchObject({
      type: 'SOURCE_EDIT_VALIDATED',
      sourceEdit: {
        fieldStates: [
          { key: 'text:only', status: 'ready' },
          { key: 'style:color', status: 'changed' },
        ],
      },
    });
  });

  it('tracks pinned elements via ResizeObserver and clears pinnedWatchedSelector on CLEAR_PIN without leaking', () => {
    const { h, button, control } = richFixture();
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 20,
      clientY: 20,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    h.runRaf();
    const initialRectMsgs = h.postedToParent.filter(
      (m) => (m as { type: string }).type === 'ELEMENT_RECTS',
    );
    expect(initialRectMsgs).toHaveLength(1);
    expect(h.resizeObservers.at(-1)?.observed).toEqual([button]);

    h.triggerResize();
    h.runRaf();
    const afterResizeMsgs = h.postedToParent.filter(
      (m) => (m as { type: string }).type === 'ELEMENT_RECTS',
    );
    expect(afterResizeMsgs).toHaveLength(2);

    control('CLEAR_PIN');
    expect(h.resizeObservers.at(-1)?.disconnected).toBe(true);
    const beforeClearRaf = h.postedToParent.filter(
      (m) => (m as { type: string }).type === 'ELEMENT_RECTS',
    ).length;
    h.windowListeners.get('scroll')?.({});
    h.runRaf();
    const afterClearRaf = h.postedToParent.filter(
      (m) => (m as { type: string }).type === 'ELEMENT_RECTS',
    ).length;
    expect(afterClearRaf).toBe(beforeClearRaf);
  });

  it('emits SOURCE_EDIT_INLINE_EDIT_REQUEST on dblclick with itemIndex and typography', () => {
    const { h } = richFixture();
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 20,
      clientY: 20,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    h.documentListeners.get('dblclick')?.({
      type: 'dblclick',
      clientX: 20,
      clientY: 20,
      preventDefault,
      stopImmediatePropagation,
      target: h.hitLayer,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    const msg = h.postedToParent.at(-1);
    expect(isSourceEditInlineEditRequestMessage(msg)).toBe(true);
    expect(msg).toMatchObject({
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
      selector: '#cta',
      targetId: '10:50',
      textKey: 'text:only',
      text: 'Buy now',
      itemIndex: 1,
      typography: { fontSize: '14px', fontFamily: 'Inter', color: 'rgb(10, 20, 30)' },
      sourceHash,
      previewRevision,
    });
  });

  it('emits SOURCE_EDIT_INLINE_EDIT_REQUEST for mapSource-only targets and ignores non-ready text fields', () => {
    const h = runOverlayWithHarness(
      buildOverlayScript({
        sourceHash,
        previewRevision,
        targets: { '10:50': 'li', '60:90': 'p' },
        fieldPlans: {
          '60:90': {
            textLayout: [{ kind: 'text', value: 'Expected' }],
            editableFields: [{ kind: 'set-text', value: 'Expected' }],
          },
        },
        mapSources: {
          '10:50': {
            arrayName: 'cards',
            itemCount: 2,
            fields: [{ key: 'title', values: ['Alpha', 'Beta'] }],
          },
        },
      }),
    );
    const li = {
      nodeType: 1,
      tagName: 'LI',
      id: 'card-item',
      parentElement: h.body,
      style: {},
      isConnected: true,
      outerHTML: '<li id="card-item">Beta</li>',
      childNodes: [{ nodeType: 3, textContent: 'Beta' }],
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id'
          ? `${previewRevision}:10:50`
          : name === 'data-codesign-item-index'
            ? '1'
            : null,
      getBoundingClientRect: () => ({ top: 40, left: 20, width: 200, height: 44 }),
    };
    const changedP = {
      nodeType: 1,
      tagName: 'P',
      id: 'changed-p',
      parentElement: h.body,
      style: {},
      isConnected: true,
      outerHTML: '<p id="changed-p">Mutated</p>',
      childNodes: [{ nodeType: 3, textContent: 'Mutated' }],
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id' ? `${previewRevision}:60:90` : null,
      getBoundingClientRect: () => ({ top: 100, left: 20, width: 200, height: 24 }),
    };
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: { __codesign: true, type: 'SET_MODE', mode: 'source-edit' },
    });

    h.setHitTarget(li);
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 25,
      clientY: 50,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    h.documentListeners.get('dblclick')?.({
      type: 'dblclick',
      clientX: 25,
      clientY: 50,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    const mapMsg = h.postedToParent.at(-1);
    expect(isSourceEditInlineEditRequestMessage(mapMsg)).toBe(true);
    expect(mapMsg).toMatchObject({
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
      targetId: '10:50',
      textKey: 'map-text:1:title',
      text: 'Beta',
      itemIndex: 1,
    });

    const beforeChanged = h.postedToParent.length;
    h.setHitTarget(changedP);
    h.documentListeners.get('pointerdown')?.({
      type: 'pointerdown',
      clientX: 25,
      clientY: 110,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    const afterSelect = h.postedToParent.length;
    expect(afterSelect).toBeGreaterThan(beforeChanged);
    h.documentListeners.get('dblclick')?.({
      type: 'dblclick',
      clientX: 25,
      clientY: 110,
      preventDefault: () => {},
      stopImmediatePropagation: () => {},
      target: h.hitLayer,
    });
    expect(h.postedToParent).toHaveLength(afterSelect);
  });

  it('executes SOURCE_EDIT_HOT_SWAP preserving scroll/screen and restoring selection, or reports errors', () => {
    const { h } = richFixture();
    h.fakeWindow['scrollX'] = 12;
    h.fakeWindow['scrollY'] = 180;
    h.documentElement.setAttribute('data-oc-active-screen', 'checkout');
    const swappedBtn = {
      nodeType: 1,
      tagName: 'BUTTON',
      id: 'cta',
      parentElement: h.body,
      style: {},
      isConnected: true,
      outerHTML: '<button id="cta">Swapped</button>',
      childNodes: [{ nodeType: 3, textContent: 'Swapped' }],
      getAttribute: (name: string) =>
        name === 'data-codesign-source-id' ? 'rev-next:20:60' : null,
      getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 32 }),
    };
    const nextHash = 'e'.repeat(64);
    h.fakeWindow['__codesign_hot_swap__'] = vi.fn(() => {
      h.selectorMatches.set('#cta', [swappedBtn]);
      return true;
    });
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: {
        __codesign: true,
        type: 'SOURCE_EDIT_HOT_SWAP',
        requestId: 'swap-1',
        instrumentedSource: '<button>Swapped</button>',
        kind: 'jsx',
        restoreSelector: '#cta',
        sourceEditContext: {
          sourceHash: nextHash,
          previewRevision: 'rev-next',
          targets: { '20:60': 'button' },
          fieldPlans: {
            '20:60': {
              textLayout: [{ kind: 'text', value: 'Swapped' }],
              editableFields: [{ kind: 'set-text', value: 'Swapped' }],
            },
          },
        },
      },
    });

    const swappedMsg = h.postedToParent.at(-1);
    expect(isSourceEditHotSwappedMessage(swappedMsg)).toBe(true);
    expect(swappedMsg).toEqual({
      __codesign: true,
      type: 'SOURCE_EDIT_HOT_SWAPPED',
      requestId: 'swap-1',
      ok: true,
    });
    expect(h.fakeWindow['scrollTo']).toHaveBeenCalledWith(12, 180);
    expect(h.documentElement.getAttribute('data-oc-active-screen')).toBe('checkout');
    const restoredSelection = h.postedToParent.find(
      (msg) =>
        (msg as { type?: string; sourceEdit?: { previewRevision?: string } }).type ===
          'ELEMENT_SELECTED' &&
        (msg as { sourceEdit?: { previewRevision?: string } }).sourceEdit?.previewRevision ===
          'rev-next',
    );
    expect(restoredSelection).toMatchObject({
      selector: '#cta',
      sourceEdit: { targetId: '20:60', previewRevision: 'rev-next' },
    });

    // Error path when hot-swap throws.
    h.fakeWindow['__codesign_hot_swap__'] = () => {
      throw new Error('Compile boom');
    };
    h.windowListeners.get('message')?.({
      source: h.parent,
      data: {
        __codesign: true,
        type: 'SOURCE_EDIT_HOT_SWAP',
        requestId: 'swap-2',
        instrumentedSource: 'broken(',
        kind: 'jsx',
        sourceEditContext: {
          sourceHash: nextHash,
          previewRevision: 'rev-next-2',
          targets: {},
        },
      },
    });
    const failedMsg = h.postedToParent.at(-1);
    expect(isSourceEditHotSwappedMessage(failedMsg)).toBe(true);
    expect(failedMsg).toEqual({
      __codesign: true,
      type: 'SOURCE_EDIT_HOT_SWAPPED',
      requestId: 'swap-2',
      ok: false,
      error: 'Compile boom',
    });
  });
});
