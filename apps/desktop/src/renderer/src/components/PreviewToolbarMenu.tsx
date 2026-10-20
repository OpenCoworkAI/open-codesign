import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface PreviewMenuItem {
  id: string;
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function previewMenuPosition(input: {
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  gap: number;
}) {
  const { gap, viewportWidth, viewportHeight } = input;
  const below = Math.max(0, viewportHeight - input.bottom - gap * 2);
  const above = Math.max(0, input.top - gap * 2);
  const openAbove = below < input.height && above > below;
  const maxHeight = Math.max(0, openAbove ? above : below);
  return {
    left: Math.max(gap, Math.min(input.right - input.width, viewportWidth - input.width - gap)),
    top: openAbove
      ? Math.max(gap, input.top - gap - Math.min(input.height, maxHeight))
      : Math.max(gap, input.bottom + gap),
    maxHeight,
  };
}

export function previewMenuNextIndex(key: string, current: number, count: number): number {
  if (count === 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}

export function PreviewToolbarMenu({
  label,
  children,
  disabled,
  items,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  disabled: boolean;
  items: PreviewMenuItem[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof previewMenuPosition> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const visible = open && !disabled;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const updatePosition = () => {
      const anchor = trigger.getBoundingClientRect();
      if (anchor.width === 0 || anchor.height === 0) {
        setOpen(false);
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(menu).getPropertyValue('--space-2'));
      setPosition(
        previewMenuPosition({
          right: anchor.right,
          top: anchor.top,
          bottom: anchor.bottom,
          width: menu.getBoundingClientRect().width,
          height: menu.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          gap,
        }),
      );
    };
    updatePosition();
    const buttons = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const selected = menu.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    const focusFrame = requestAnimationFrame(() => {
      (initialFocus.current === 'last'
        ? buttons[buttons.length - 1]
        : (selected ?? buttons[0])
      )?.focus();
    });

    function dismissOutside(event: Event) {
      if (
        event.target instanceof Node &&
        !menu?.contains(event.target) &&
        !trigger?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    const observer = new ResizeObserver(updatePosition);
    observer.observe(trigger);
    if (trigger.parentElement) observer.observe(trigger.parentElement);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [visible]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    } else if (event.key === 'Tab') {
      // Resume the document's tab order from the trigger, not the body portal.
      closeAndRestoreFocus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      const current =
        document.activeElement instanceof HTMLButtonElement
          ? buttons.indexOf(document.activeElement)
          : -1;
      buttons[previewMenuNextIndex(event.key, current, buttons.length)]?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        className="codesign-preview-control"
        onClick={() => {
          initialFocus.current = 'first';
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }}
      >
        {children}
      </button>
      {visible &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-labelledby={`${id}-trigger`}
            className={`codesign-preview-menu${compact ? ' codesign-preview-menu-compact' : ''}`}
            style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  closeAndRestoreFocus();
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="codesign-preview-menu-hint">{item.hint}</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
