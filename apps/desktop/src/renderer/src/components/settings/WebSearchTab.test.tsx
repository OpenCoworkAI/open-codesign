import { readFileSync } from 'node:fs';
import { WebSearchTestResult } from '@open-codesign/shared';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_SEARCH_TEST_MESSAGES, WebSearchTab } from './WebSearchTab';

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  effects: [] as (() => undefined | (() => void))[],
}));
vi.mock('@open-codesign/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.state)) hooks.state[index] = initial;
    return [
      hooks.state[index],
      (next: unknown) => {
        hooks.state[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useEffect: (effect: () => undefined | (() => void)) => hooks.effects.push(effect),
}));

const api = {
  get: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
};
const openExternal = vi.fn();
function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  return WebSearchTab();
}
type Props = {
  children?: ReactNode;
  type?: string;
  role?: string;
  onClick?: () => Promise<void> | void;
  onChange?: (event: { target: { checked: boolean } }) => void;
  onSubmit?: (event: { preventDefault: () => void; currentTarget: HTMLFormElement }) => void;
  disabled?: boolean;
};
function find(node: ReactNode, match: (props: Props) => boolean): Props {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return find(child, match);
      } catch {
        /* try the next sibling */
      }
    }
  } else if (isValidElement<Props>(node)) {
    if (match(node.props)) return node.props;
    return find(node.props.children, match);
  }
  throw new Error('Element not found');
}
async function mount() {
  render();
  const cleanup = hooks.effects[0]?.();
  await Promise.resolve();
  return cleanup;
}
function button(label: string) {
  return find(render(), (props) => props.children === label);
}

beforeEach(() => {
  hooks.state = [];
  hooks.refs = [];
  hooks.effects = [];
  vi.resetAllMocks();
  api.get.mockResolvedValue({ enabled: false, hasKey: true });
  api.save.mockResolvedValue({ enabled: false, hasKey: true });
  api.test.mockResolvedValue({ status: 'ok' });
  vi.stubGlobal('window', { codesign: { webSearch: api, openExternal } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Tavily Settings UI', () => {
  it('loads only state and never automatically tests on mount or after saving', async () => {
    await mount();
    expect(api.get).toHaveBeenCalledExactlyOnceWith();
    expect(api.test).not.toHaveBeenCalled();
    find(render(), (props) => props.role === 'switch').onChange?.({ target: { checked: true } });
    await Promise.resolve();
    expect(api.save).toHaveBeenCalledExactlyOnceWith({ enabled: true });
    expect(api.test).not.toHaveBeenCalled();
  });

  it('shows a blank password field and configured status, not a saved key or mask', async () => {
    await mount();
    const html = renderToStaticMarkup(render());
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('value=""');
    expect(html).toContain('settings.webSearch.configured');
    expect(html).toContain('settings.webSearch.saveReplacement');
    expect(html).toContain('settings.webSearch.testHint');
    expect(html).not.toContain('maskedKey');
  });

  it('tests only the saved key by explicit click even with an unsaved replacement', async () => {
    await mount();
    hooks.state[1] = 'unsaved-secret';
    const test = find(
      render(),
      (props) =>
        props.onClick !== undefined &&
        Array.isArray(props.children) &&
        props.children.includes('settings.webSearch.test'),
    );
    await test.onClick?.();
    expect(api.test).toHaveBeenCalledExactlyOnceWith();
    expect(api.save).not.toHaveBeenCalled();
    expect(hooks.state[3]).toEqual({ key: WEB_SEARCH_TEST_MESSAGES.ok, error: false });
  });

  it('saves replacement separately and clears the input even when saving fails', async () => {
    await mount();
    hooks.state[1] = 'replacement-fixture';
    vi.stubGlobal(
      'FormData',
      class {
        get() {
          return hooks.state[1];
        }
      },
    );
    api.save.mockRejectedValueOnce(new Error('secret upstream response'));
    find(render(), (props) => props.onSubmit !== undefined).onSubmit?.({
      preventDefault: vi.fn(),
      currentTarget: {} as HTMLFormElement,
    });
    await Promise.resolve();
    expect(api.save).toHaveBeenCalledExactlyOnceWith({ apiKey: 'replacement-fixture' });
    expect(hooks.state[1]).toBe('');
    expect(hooks.state[3]).toEqual({ key: 'settings.webSearch.saveFailed', error: true });
  });

  it('requires confirmation before explicitly clearing the saved key', async () => {
    await mount();
    await button('settings.webSearch.clearKey').onClick?.();
    expect(api.save).not.toHaveBeenCalled();
    await button('settings.webSearch.confirmClear').onClick?.();
    expect(api.save).toHaveBeenCalledExactlyOnceWith({ clearKey: true });
  });

  it('disables saved-key testing when no key is configured', async () => {
    api.get.mockResolvedValueOnce({ enabled: false, hasKey: false });
    await mount();
    const test = find(
      render(),
      (props) =>
        props.onClick !== undefined &&
        Array.isArray(props.children) &&
        props.children.includes('settings.webSearch.test'),
    );
    expect(test.disabled).toBe(true);
    await test.onClick?.();
    expect(api.test).not.toHaveBeenCalled();
  });

  it('opens only the official key page through the existing external opener', async () => {
    await mount();
    const open = find(
      render(),
      (props) =>
        props.onClick !== undefined &&
        Array.isArray(props.children) &&
        props.children.includes('settings.webSearch.getKey'),
    );
    await open.onClick?.();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://app.tavily.com');
  });

  it('prevents concurrent probes and ignores late results after unmount', async () => {
    const cleanup = await mount();
    let resolve: ((value: unknown) => void) | undefined;
    api.test.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const test = find(
      render(),
      (props) =>
        props.onClick !== undefined &&
        Array.isArray(props.children) &&
        props.children.includes('settings.webSearch.test'),
    );
    test.onClick?.();
    test.onClick?.();
    expect(api.test).toHaveBeenCalledTimes(1);
    find(render(), (props) => props.role === 'switch').onChange?.({ target: { checked: true } });
    expect(api.save).not.toHaveBeenCalled();
    cleanup?.();
    resolve?.({ status: 'ok', message: 'sensitive response' });
    await Promise.resolve();
    expect(hooks.state[3]).toBeNull();
  });

  it('sanitizes rejected and malformed results but retains a bounded numeric HTTP status', async () => {
    await mount();
    api.test.mockRejectedValueOnce(new Error('secret raw error'));
    const clickTest = () =>
      find(
        render(),
        (props) =>
          props.onClick !== undefined &&
          Array.isArray(props.children) &&
          props.children.includes('settings.webSearch.test'),
      ).onClick?.();
    await clickTest();
    expect(hooks.state[3]).toEqual({ key: 'settings.webSearch.testFailed', error: true });
    api.test.mockResolvedValueOnce({ status: 'ok', message: 'secret raw result' });
    await clickTest();
    expect(hooks.state[3]).toEqual({ key: 'settings.webSearch.testFailed', error: true });
    api.test.mockResolvedValueOnce({ status: 'unexpected-response', httpStatus: 418 });
    await clickTest();
    expect(hooks.state[3]).toEqual({
      key: WEB_SEARCH_TEST_MESSAGES['unexpected-response'],
      error: true,
      httpStatus: 418,
    });
    expect(renderToStaticMarkup(render())).toContain('(HTTP 418)');
  });

  it('has localized copy for every status and the disclosure/next-run boundaries', () => {
    expect(Object.keys(WEB_SEARCH_TEST_MESSAGES)).toEqual(WebSearchTestResult.shape.status.options);
    for (const locale of ['en', 'zh-CN']) {
      const messages = JSON.parse(
        readFileSync(
          new URL(`../../../../../../../packages/i18n/src/locales/${locale}.json`, import.meta.url),
          'utf8',
        ),
      );
      for (const key of Object.values(WEB_SEARCH_TEST_MESSAGES)) {
        const leaf = key.split('.').at(-1);
        expect(messages.settings.webSearch.result[leaf ?? '']).toBeTruthy();
      }
      expect(messages.settings.tabs.webSearch).toBeTruthy();
      expect(messages.settings.webSearch.description).toContain('Tavily');
      expect(messages.settings.webSearch.nextRun).toBeTruthy();
      expect(messages.settings.webSearch.testHint).toContain('1 credit');
    }
    const source = readFileSync(new URL('./WebSearchTab.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /console\.|localStorage|sessionStorage|useCodesignStore|cleanIpcError|\.message/,
    );
  });
});
