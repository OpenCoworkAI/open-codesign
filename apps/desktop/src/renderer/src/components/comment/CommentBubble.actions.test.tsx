import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentBubble, type CommentBubbleProps } from './CommentBubble';

const updates = vi.hoisted(() => [] as unknown[]);
vi.mock('@open-codesign/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useId: () => 'comment',
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: <T,>(fn: T) => fn,
  useRef: <T,>(current: T) => ({ current }),
  useState: <T,>(value: T) => [value, (next: unknown) => updates.push(next)],
}));

interface NodeProps {
  children?: ReactNode;
  'aria-label'?: string;
  onClick?: () => void;
}

function button(node: ReactNode, label: string): () => void {
  let found: (() => void) | undefined;
  function visit(children: ReactNode) {
    Children.forEach(children, (child) => {
      if (!isValidElement<NodeProps>(child)) return;
      if (child.props['aria-label'] === label) found = child.props.onClick;
      visit(child.props.children);
    });
  }
  visit(node);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

function render(onSave: CommentBubbleProps['onSaveAndClose'], initialText = 'Keep my draft') {
  vi.stubGlobal('document', { body: {} });
  const onDismiss = vi.fn();
  const node = CommentBubble({
    selector: '#target',
    tag: 'button',
    outerHTML: '<button>Target</button>',
    rect: { top: 0, left: 0, width: 100, height: 40 },
    initialText,
    onDismiss,
    onSaveAndClose: onSave,
    onSaveAndSend: onSave,
  });
  return {
    save: button(node, 'commentBubble.saveNote'),
    send: button(node, 'commentBubble.sendToChat'),
    dismiss: button(node, 'commentBubble.close'),
    onDismiss,
  };
}

afterEach(() => {
  updates.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('comment composer action lifecycle', () => {
  it('deduplicates synchronous save/send clicks and blocks dismissal while pending', async () => {
    let resolve!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const ui = render(save);
    ui.save();
    ui.send();
    ui.dismiss();
    expect(save).toHaveBeenCalledExactlyOnceWith('Keep my draft');
    expect(ui.onDismiss).not.toHaveBeenCalled();
    resolve(true);
    await vi.waitFor(() => expect(updates.at(-1)).toBeNull());
    ui.dismiss();
    expect(ui.onDismiss).toHaveBeenCalledOnce();
  });

  it.each([
    'false',
    'reject',
  ] as const)('retains a visible error and unlocks retry after %s', async (failure) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const save = vi
      .fn()
      .mockImplementationOnce(() =>
        failure === 'false' ? Promise.resolve(false) : Promise.reject(new Error('Save rejected')),
      )
      .mockResolvedValue(true);
    const ui = render(save);
    ui.send();
    await vi.waitFor(() =>
      expect(updates).toContain(
        failure === 'false' ? 'notifications.commentCreateFailed' : 'Save rejected',
      ),
    );
    expect(updates.at(-1)).toBeNull();
    expect(ui.onDismiss).not.toHaveBeenCalled();
    ui.save();
    expect(save).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(updates.at(-1)).toBeNull());
  });

  it('does not save blank text and dismisses without persisting a draft', () => {
    const save = vi.fn(() => true);
    const empty = render(save, '   ');
    empty.save();
    empty.send();
    empty.dismiss();
    expect(save).not.toHaveBeenCalled();
    expect(empty.onDismiss).toHaveBeenCalledOnce();
    render(save).dismiss();
    expect(save).not.toHaveBeenCalled();
  });
});
