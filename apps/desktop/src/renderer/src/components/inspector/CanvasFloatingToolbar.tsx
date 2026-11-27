import { useT } from '@open-codesign/i18n';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';

export interface CanvasFloatingToolbarRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CanvasFloatingToolbarProps {
  rect: CanvasFloatingToolbarRect | null;
  containerWidth: number;
  containerHeight: number;
  hidden?: boolean | undefined;
  busy?: boolean | undefined;
  canSelectParent?: boolean | undefined;
  canReorderUp?: boolean | undefined;
  canReorderDown?: boolean | undefined;
  canDuplicate?: boolean | undefined;
  canToggleVisibility?: boolean | undefined;
  canDelete?: boolean | undefined;
  horizontalFlow?: boolean | undefined;
  onSelectParent?: (() => void) | undefined;
  onReorderUp?: (() => void) | undefined;
  onReorderDown?: (() => void) | undefined;
  onDuplicate?: (() => void) | undefined;
  onToggleVisibility?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onAskAi?: (() => void) | undefined;
}

const EDGE_PAD = 8;
const DEFAULT_WIDTH = 248;
const DEFAULT_HEIGHT = 34;

export function computeToolbarPosition(
  rect: CanvasFloatingToolbarRect,
  toolbarWidth: number,
  toolbarHeight: number,
  containerWidth: number,
  containerHeight: number,
  gap = 8,
): { top: number; left: number; placement: 'above' | 'below' } {
  const w = toolbarWidth > 0 ? toolbarWidth : DEFAULT_WIDTH;
  const h = toolbarHeight > 0 ? toolbarHeight : DEFAULT_HEIGHT;
  const maxTop = Math.max(EDGE_PAD, containerHeight - h - EDGE_PAD);
  const maxLeft = Math.max(EDGE_PAD, containerWidth - w - EDGE_PAD);

  const aboveTop = rect.top - h - gap;
  const belowTop = rect.top + rect.height + gap;
  let placement: 'above' | 'below' = 'above';
  let top = aboveTop;
  if (aboveTop < EDGE_PAD) {
    placement = 'below';
    top = belowTop <= maxTop ? belowTop : maxTop;
  }
  top = Math.min(maxTop, Math.max(EDGE_PAD, top));

  const centeredLeft = rect.left + rect.width / 2 - w / 2;
  const left = Math.min(maxLeft, Math.max(EDGE_PAD, centeredLeft));
  return { top: Math.round(top), left: Math.round(left), placement };
}

export function CanvasFloatingToolbar({
  rect,
  containerWidth,
  containerHeight,
  hidden = false,
  busy = false,
  canSelectParent = false,
  canReorderUp = false,
  canReorderDown = false,
  canDuplicate = false,
  canToggleVisibility = false,
  canDelete = false,
  horizontalFlow = false,
  onSelectParent,
  onReorderUp,
  onReorderDown,
  onDuplicate,
  onToggleVisibility,
  onDelete,
  onAskAi,
}: CanvasFloatingToolbarProps) {
  const t = useT();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measured = el.getBoundingClientRect();
    if (measured.width > 0 && measured.height > 0) {
      setSize((prev) =>
        prev.width === measured.width && prev.height === measured.height
          ? prev
          : { width: measured.width, height: measured.height },
      );
    }
  });

  if (!rect) return null;
  const hasAnyAction =
    onSelectParent ||
    onReorderUp ||
    onReorderDown ||
    onDuplicate ||
    onToggleVisibility ||
    onDelete ||
    onAskAi;
  if (!hasAnyAction) return null;

  const pos = computeToolbarPosition(
    rect,
    size.width,
    size.height,
    containerWidth,
    containerHeight,
  );

  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  const btnClass =
    'inline-flex size-[26px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-35';

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t('inspector.element.toolbarLabel')}
      data-placement={pos.placement}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onToolbarKeyDown}
      style={{ top: pos.top, left: pos.left }}
      className="pointer-events-auto absolute z-30 flex items-center gap-[2px] rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-[3px] shadow-[var(--shadow-elevated)] backdrop-blur"
    >
      {onSelectParent ? (
        <button
          type="button"
          disabled={busy || !canSelectParent}
          onClick={onSelectParent}
          aria-label={t('inspector.element.selectParent')}
          title={t('inspector.element.selectParent')}
          className={btnClass}
        >
          <ArrowUp className="size-[13px]" aria-hidden />
        </button>
      ) : null}
      {onReorderUp ? (
        <button
          type="button"
          disabled={busy || !canReorderUp}
          onClick={onReorderUp}
          aria-label={
            horizontalFlow ? t('inspector.element.moveLeft') : t('inspector.element.moveUp')
          }
          title={horizontalFlow ? t('inspector.element.moveLeft') : t('inspector.element.moveUp')}
          className={btnClass}
        >
          {horizontalFlow ? (
            <ArrowLeft className="size-[13px]" aria-hidden />
          ) : (
            <ChevronUp className="size-[13px]" aria-hidden />
          )}
        </button>
      ) : null}
      {onReorderDown ? (
        <button
          type="button"
          disabled={busy || !canReorderDown}
          onClick={onReorderDown}
          aria-label={
            horizontalFlow ? t('inspector.element.moveRight') : t('inspector.element.moveDown')
          }
          title={
            horizontalFlow ? t('inspector.element.moveRight') : t('inspector.element.moveDown')
          }
          className={btnClass}
        >
          {horizontalFlow ? (
            <ArrowRight className="size-[13px]" aria-hidden />
          ) : (
            <ChevronDown className="size-[13px]" aria-hidden />
          )}
        </button>
      ) : null}
      {onDuplicate ? (
        <button
          type="button"
          disabled={busy || !canDuplicate}
          onClick={onDuplicate}
          aria-label={t('inspector.element.duplicate')}
          title={t('inspector.element.duplicate')}
          className={btnClass}
        >
          <Copy className="size-[13px]" aria-hidden />
        </button>
      ) : null}
      {onToggleVisibility ? (
        <button
          type="button"
          disabled={busy || !canToggleVisibility}
          aria-pressed={hidden}
          onClick={onToggleVisibility}
          aria-label={hidden ? t('inspector.element.show') : t('inspector.element.hide')}
          title={hidden ? t('inspector.element.show') : t('inspector.element.hide')}
          className={btnClass}
        >
          {hidden ? (
            <Eye className="size-[13px]" aria-hidden />
          ) : (
            <EyeOff className="size-[13px]" aria-hidden />
          )}
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          disabled={busy || !canDelete}
          onClick={onDelete}
          aria-label={t('inspector.element.delete')}
          title={t('inspector.element.delete')}
          className="inline-flex size-[26px] items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)] disabled:pointer-events-none disabled:opacity-35"
        >
          <Trash2 className="size-[13px]" aria-hidden />
        </button>
      ) : null}
      {onAskAi ? (
        <button
          type="button"
          disabled={busy}
          onClick={onAskAi}
          aria-label={t('inspector.element.askAi')}
          title={t('inspector.element.askAi')}
          className="inline-flex size-[26px] items-center justify-center rounded-full text-[var(--color-accent)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-accent-tint)] disabled:pointer-events-none disabled:opacity-35"
        >
          <Sparkles className="size-[13px]" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
