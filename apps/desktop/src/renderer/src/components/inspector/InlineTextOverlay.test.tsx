// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineTextOverlay, type InlineTextRequest } from './InlineTextOverlay';

vi.mock('@open-codesign/i18n', () => ({
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: Root;

const baseRequest: InlineTextRequest = {
  targetId: '10:30',
  initialText: 'Original heading',
  rect: { top: 40, left: 24, width: 240, height: 36 },
  typography: {
    fontFamily: 'Georgia, serif',
    fontSize: '28px',
    fontWeight: '700',
    textAlign: 'center',
    color: 'rgb(17, 24, 39)',
  },
};

async function renderNode(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('InlineTextOverlay', () => {
  it('renders null when closed and copies rect & typography styles when open', async () => {
    await renderNode(<InlineTextOverlay request={null} onCommit={vi.fn()} onCancel={vi.fn()} />);
    expect(container.innerHTML).toBe('');

    await renderNode(
      <InlineTextOverlay request={baseRequest} onCommit={vi.fn()} onCancel={vi.fn()} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    const textarea = container.querySelector('textarea');
    expect(wrapper.style.top).toBe('40px');
    expect(wrapper.style.left).toBe('24px');
    expect(wrapper.style.width).toBe('240px');
    expect(textarea?.value).toBe('Original heading');
    expect(textarea?.style.fontFamily).toContain('Georgia');
    expect(textarea?.style.fontSize).toBe('28px');
    expect(textarea?.style.textAlign).toBe('center');
  });

  it('commits on Enter and blurs safely without double-firing or empty commits', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const onDraftChange = vi.fn();

    await renderNode(
      <InlineTextOverlay
        request={baseRequest}
        onDraftChange={onDraftChange}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing textarea');
    await setTextareaValue(textarea, 'Updated title');
    expect(onDraftChange).toHaveBeenCalledWith('Updated title');

    // Shift+Enter does not commit
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(onCommit).not.toHaveBeenCalled();

    // Enter commits and prevents subsequent blur from committing twice
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      textarea.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Updated title');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape and handles CJK IME composition without premature commit', async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    await renderNode(
      <InlineTextOverlay request={baseRequest} onCommit={onCommit} onCancel={onCancel} />,
    );
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing textarea');

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    await setTextareaValue(textarea, 'ni');
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '你好');
      textarea.dispatchEvent(
        new CompositionEvent('compositionend', { data: '你好', bubbles: true }),
      );
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onCommit).toHaveBeenCalledWith('你好');

    // Fresh request cancelled via Escape never commits on blur
    const onCommit2 = vi.fn();
    const onCancel2 = vi.fn();
    await renderNode(
      <InlineTextOverlay
        request={{ ...baseRequest, targetId: '10:31', initialText: 'Second' }}
        onCommit={onCommit2}
        onCancel={onCancel2}
      />,
    );
    const textarea2 = container.querySelector('textarea');
    if (!textarea2) throw new Error('Missing second textarea');
    await setTextareaValue(textarea2, 'Changed');
    await act(async () => {
      textarea2.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      textarea2.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    expect(onCancel2).toHaveBeenCalledTimes(1);
    expect(onCommit2).not.toHaveBeenCalled();
  });

  it('supports multiline requests where Cmd/Ctrl+Enter commits and plain Enter keeps newline', async () => {
    const onCommit = vi.fn();
    await renderNode(
      <InlineTextOverlay
        request={{ ...baseRequest, multiline: true }}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('Missing multiline textarea');
    await setTextareaValue(textarea, 'Line 1\nLine 2');
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCommit).toHaveBeenCalledWith('Line 1\nLine 2');
  });
});
