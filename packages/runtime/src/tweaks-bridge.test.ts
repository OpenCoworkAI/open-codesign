import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIframeErrorMessage } from './iframe-errors';
import {
  isTweakCompatibilityNotice,
  TWEAKS_BRIDGE_LISTENER,
  TWEAKS_BRIDGE_SETUP,
} from './tweaks-bridge';

type MessageListener = (event: { data: unknown }) => void;

function installTweaksBridge() {
  const listeners = new Map<string, MessageListener>();
  const setProperty = vi.fn();
  const transform = vi.fn();
  const render = vi.fn();
  const useMemo = vi.fn((factory: () => unknown, _dependencies: unknown[]) => factory());
  const useCallback = vi.fn((callback: () => unknown, _dependencies: unknown[]) => callback);
  const fakeWindow = {
    Babel: { transform },
    parent: { postMessage: vi.fn() },
    React: {
      useMemo,
      useCallback,
      isValidElement: (value: unknown) => typeof value === 'object' && value !== null,
      cloneElement: vi.fn((element: object) => ({ ...element })),
    },
    ReactDOM: {
      createRoot: vi.fn(() => ({ render })),
    },
    addEventListener: vi.fn((type: string, listener: MessageListener) => {
      listeners.set(type, listener);
    }),
    requestAnimationFrame: vi.fn((callback: () => void) => {
      callback();
      return 1;
    }),
  };
  const fakeDocument = {
    documentElement: {
      style: { setProperty },
    },
  };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);

  new Function(TWEAKS_BRIDGE_SETUP)();
  new Function(TWEAKS_BRIDGE_LISTENER)();

  return {
    listeners,
    setProperty,
    transform,
    render,
    useMemo,
    useCallback,
    window: fakeWindow as typeof fakeWindow & {
      __codesign_tweaks__: {
        applyInitial: (source: string) => void;
        tokens: Record<string, string>;
        runModule: (run: () => void) => void;
      };
    },
  };
}

describe('tweaks bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates initial EDITMODE tokens into canonical CSS custom properties', () => {
    const bridge = installTweaksBridge();

    bridge.window.__codesign_tweaks__.applyInitial(
      'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accentColor":"#f97316","density":1.25,"darkMode":false}/*EDITMODE-END*/;',
    );

    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-accent-color', '#f97316');
    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-density', '1.25');
    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-dark-mode', '0');
  });

  it('applies live updates without invoking Babel', () => {
    const bridge = installTweaksBridge();
    const listener = bridge.listeners.get('message');
    const root = bridge.window.ReactDOM.createRoot();
    const component = () => null;
    const element = { type: component, key: 'stable', props: {} };
    root.render(element);
    expect(listener).toBeDefined();

    listener?.({
      data: {
        type: 'codesign:tweaks:update',
        tokens: { accentColor: '#0ea5e9', radiusBase: '12px', enabled: true },
      },
    });

    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-accent-color', '#0ea5e9');
    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-radius-base', '12px');
    expect(bridge.setProperty).toHaveBeenCalledWith('--ocd-tweak-enabled', '1');
    expect(bridge.render).toHaveBeenCalledTimes(2);
    expect(bridge.render.mock.calls[1]?.[0]).toEqual(element);
    expect(bridge.render.mock.calls[1]?.[0]).not.toBe(element);
    expect(bridge.render.mock.calls[1]?.[0].type).toBe(component);
    expect(bridge.window.React.cloneElement).toHaveBeenCalledExactlyOnceWith(element);
    expect(bridge.transform).not.toHaveBeenCalled();
  });

  it('retains a cloneable token object and reports fallback once without an iframe error', () => {
    const bridge = installTweaksBridge();
    const api = bridge.window.__codesign_tweaks__;
    api.applyInitial('/*EDITMODE-BEGIN*/{"heading":"Original"}/*EDITMODE-END*/');
    const tokens = api.tokens;
    const root = bridge.window.ReactDOM.createRoot();
    const run = vi.fn(() => root.render({ type: () => null, props: structuredClone(api.tokens) }));
    api.runModule(run);
    expect(bridge.window.parent.postMessage).not.toHaveBeenCalled();
    const listener = bridge.listeners.get('message');
    listener?.({ data: { type: 'codesign:tweaks:update', tokens: { heading: 'Original' } } });
    expect(run).toHaveBeenCalledOnce();
    for (const heading of ['First', 'Second']) {
      listener?.({ data: { type: 'codesign:tweaks:update', tokens: { heading } } });
    }
    expect(api.tokens).toBe(tokens);
    expect(structuredClone(api.tokens)).toEqual({ heading: 'Second' });
    expect(run).toHaveBeenCalledTimes(3);
    expect(bridge.window.parent.postMessage).toHaveBeenCalledOnce();
    const notice = bridge.window.parent.postMessage.mock.calls[0]?.[0];
    expect(isTweakCompatibilityNotice(notice)).toBe(true);
    expect(isIframeErrorMessage(notice)).toBe(false);
  });

  it('rejects malformed compatibility notices', () => {
    for (const data of [
      null,
      {},
      { type: 'IFRAME_ERROR', message: 'wrong type' },
      {
        type: 'codesign:tweaks:compatibility',
        message: 42,
      },
    ])
      expect(isTweakCompatibilityNotice(data)).toBe(false);
  });

  it.each([
    'useMemo',
    'useCallback',
  ] as const)('forwards %s unchanged and reports conservative replay only on changed tokens', (hook) => {
    const bridge = installTweaksBridge();
    const api = bridge.window.__codesign_tweaks__;
    api.applyInitial('/*EDITMODE-BEGIN*/{"heading":"Original"}/*EDITMODE-END*/');
    const root = bridge.window.ReactDOM.createRoot();
    const run = vi.fn(() => root.render({ type: () => null, props: {} }));
    api.runModule(run);
    const captured = api.tokens['heading'];
    const factory = vi.fn(() => captured);
    const dependencies: unknown[] = [];
    const result = bridge.window.React[hook](factory, dependencies);
    expect(bridge[hook]).toHaveBeenCalledExactlyOnceWith(factory, dependencies);
    expect(result).toBe(hook === 'useMemo' ? captured : factory);
    expect(factory).toHaveBeenCalledTimes(hook === 'useMemo' ? 1 : 0);
    expect(bridge.window.parent.postMessage).not.toHaveBeenCalled();
    for (const heading of ['Original', 'First', 'Second']) {
      bridge.listeners.get('message')?.({
        data: { type: 'codesign:tweaks:update', tokens: { heading } },
      });
    }
    expect(run).toHaveBeenCalledTimes(3);
    expect(bridge.window.parent.postMessage).toHaveBeenCalledOnce();
    const notice = bridge.window.parent.postMessage.mock.calls[0]?.[0];
    expect(isTweakCompatibilityNotice(notice)).toBe(true);
    expect(isIframeErrorMessage(notice)).toBe(false);
  });
});
