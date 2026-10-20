import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentsPanel } from './CommentsPanel';

const hooks = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  updates: [] as unknown[],
}));
vi.mock('@open-codesign/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useEffect: () => {},
  useLayoutEffect: (effect: () => undefined | (() => void)) => hooks.effects.push(effect),
  useState: <T,>(value: T) => [value, (next: unknown) => hooks.updates.push(next)],
}));
vi.mock('../../store', () => ({
  useCodesignStore: (select: (state: unknown) => unknown) =>
    select({
      view: 'workspace',
      interactionMode: 'comment',
      currentDesignId: 'fixture',
      comments: [],
      queuedCommentIds: [],
    }),
}));

afterEach(() => {
  hooks.effects.length = 0;
  hooks.updates.length = 0;
  vi.unstubAllGlobals();
});

it('tracks the actual preview header and its moving stage, and releases observers', () => {
  let bottom = 168;
  const stage = {};
  const header = { parentElement: stage, getBoundingClientRect: () => ({ bottom }) };
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal('document', { body: {}, querySelector: () => header });
  vi.stubGlobal('window', { addEventListener, removeEventListener });
  CommentsPanel();
  const cleanup = hooks.effects[0]?.();
  expect(hooks.updates).toEqual([168]);
  expect(observe.mock.calls).toEqual([[header], [stage]]);
  bottom = 240;
  resize?.();
  expect(hooks.updates.at(-1)).toBe(240);
  expect(addEventListener).toHaveBeenCalledWith('resize', resize);
  cleanup?.();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(removeEventListener).toHaveBeenCalledWith('resize', resize);
});
