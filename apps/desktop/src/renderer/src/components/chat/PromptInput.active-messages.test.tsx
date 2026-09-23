import { initI18n } from '@open-codesign/i18n';
import {
  Children,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CodesignState, useCodesignStore } from '../../store';
import { PromptInput, type PromptInputProps } from './PromptInput';

vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  forwardRef: (render: (props: PromptInputProps) => ReactNode) => render,
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useImperativeHandle: vi.fn(),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('@open-codesign/i18n', async () => {
  const actual = await vi.importActual<typeof import('@open-codesign/i18n')>('@open-codesign/i18n');
  return { ...actual, useT: () => (key: string) => actual.i18n.t(key) };
});
vi.mock('../../store', async () => {
  const actual = await vi.importActual<typeof import('../../store')>('../../store');
  return {
    ...actual,
    useCodesignStore: Object.assign(
      (selector: (state: CodesignState) => unknown) => selector(actual.useCodesignStore.getState()),
      actual.useCodesignStore,
    ),
  };
});

interface ElementProps {
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onClick?: () => void;
}
function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean,
): ReactElement<ElementProps> | undefined {
  if (!isValidElement<ElementProps>(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of Children.toArray(node.props.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}
function keyEvent(extra: Partial<KeyboardEvent<HTMLTextAreaElement>> = {}) {
  return {
    key: 'Enter',
    preventDefault: vi.fn(),
    nativeEvent: {},
    ...extra,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}
const initial = useCodesignStore.getState();
beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  useCodesignStore.setState({
    ...initial,
    currentDesignId: 'a',
    composerDrafts: { a: '  Follow up  ', b: 'Other draft' },
  });
});

describe('active composer callbacks', () => {
  it.each([
    '',
    ' \n  ',
  ])('does not offer or submit active messages for a blank draft %j', (draft) => {
    useCodesignStore.setState({ composerDrafts: { a: draft, b: 'Other draft' } });
    const active = vi.fn(async () => {});
    const normal = vi.fn();
    const tree = PromptInput({
      onSubmit: normal,
      onActiveSubmit: active,
      onCancel: vi.fn(),
      isGenerating: true,
    });
    expect(
      findElement(tree, (element) => element.props.className === 'codesign-active-message-actions'),
    ).toBeUndefined();
    expect(findElement(tree, (element) => element.type === 'details')).toBeUndefined();
    expect(
      findElement(tree, (element) => element.props['aria-label']?.startsWith('Stop') === true),
    ).toBeDefined();
    findElement(tree, (element) => element.type === 'textarea')?.props.onKeyDown?.(keyEvent());
    expect(active).not.toHaveBeenCalled();
    expect(normal).not.toHaveBeenCalled();
    expect(useCodesignStore.getState().composerDrafts).toEqual({ a: draft, b: 'Other draft' });
  });

  it.each([
    { key: 'Enter' },
    { key: 'Enter', ctrlKey: true },
  ])('queues %j rather than generating, and lets acceptance own draft clearing', (input) => {
    const active = vi.fn(async () => {});
    const normal = vi.fn();
    const tree = PromptInput({
      onSubmit: normal,
      onActiveSubmit: active,
      onCancel: vi.fn(),
      isGenerating: true,
    });
    const event = keyEvent(input);
    findElement(tree, (element) => element.type === 'textarea')?.props.onKeyDown?.(event);
    expect(active).toHaveBeenCalledWith('  Follow up  ', 'follow-up');
    expect(normal).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(useCodesignStore.getState().composerDrafts['a']).toBe('  Follow up  ');
  });

  it('preserves Shift+Enter and composition Enter including native IME fallbacks', () => {
    const active = vi.fn(async () => {});
    const tree = PromptInput({
      onSubmit: vi.fn(),
      onActiveSubmit: active,
      onCancel: vi.fn(),
      isGenerating: true,
    });
    const textarea = findElement(tree, (element) => element.type === 'textarea');
    textarea?.props.onKeyDown?.(keyEvent({ shiftKey: true }));
    textarea?.props.onCompositionStart?.();
    textarea?.props.onKeyDown?.(keyEvent());
    textarea?.props.onCompositionEnd?.();
    textarea?.props.onKeyDown?.(
      keyEvent({ nativeEvent: { isComposing: true } as KeyboardEvent['nativeEvent'] }),
    );
    textarea?.props.onKeyDown?.(keyEvent({ keyCode: 229 }));
    expect(active).not.toHaveBeenCalled();
    textarea?.props.onKeyDown?.(keyEvent());
    expect(active).toHaveBeenCalledOnce();
  });

  it('steers only from the secondary action and leaves Stop independent', () => {
    const active = vi.fn(async () => {});
    const cancel = vi.fn();
    const tree = PromptInput({
      onSubmit: vi.fn(),
      onActiveSubmit: active,
      onCancel: cancel,
      isGenerating: true,
    });
    findElement(
      tree,
      (element) => element.type === 'button' && element.props['aria-label'] === 'Steer next step',
    )?.props.onClick?.();
    expect(active).toHaveBeenCalledWith('  Follow up  ', 'steer');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('retains the normal trimmed send path and clears only the selected design draft', () => {
    const normal = vi.fn();
    const active = vi.fn(async () => {});
    const tree = PromptInput({
      onSubmit: normal,
      onActiveSubmit: active,
      onCancel: vi.fn(),
      isGenerating: false,
    });
    findElement(tree, (element) => element.type === 'textarea')?.props.onKeyDown?.(keyEvent());
    expect(normal).toHaveBeenCalledWith('Follow up');
    expect(active).not.toHaveBeenCalled();
    expect(useCodesignStore.getState().composerDrafts).toEqual({ a: '', b: 'Other draft' });
  });
});
