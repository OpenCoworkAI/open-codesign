import { useT } from '@open-codesign/i18n';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export interface InlineTextTypography {
  fontFamily?: string | undefined;
  fontSize?: string | undefined;
  fontWeight?: string | undefined;
  lineHeight?: string | undefined;
  letterSpacing?: string | undefined;
  textAlign?: string | undefined;
  color?: string | undefined;
  textTransform?: string | undefined;
  padding?: string | undefined;
}

export interface InlineTextRequest {
  targetId: string;
  textId?: string | undefined;
  initialText: string;
  rect: { top: number; left: number; width: number; height: number };
  multiline?: boolean | undefined;
  typography?: InlineTextTypography | undefined;
}

export interface InlineTextOverlayProps {
  request: InlineTextRequest | null;
  busy?: boolean | undefined;
  onDraftChange?: ((value: string) => void) | undefined;
  onCommit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

function validTextAlign(value: string | undefined): CSSProperties['textAlign'] {
  if (
    value === 'left' ||
    value === 'right' ||
    value === 'center' ||
    value === 'justify' ||
    value === 'start' ||
    value === 'end'
  ) {
    return value;
  }
  return undefined;
}

function validTextTransform(value: string | undefined): CSSProperties['textTransform'] {
  if (
    value === 'none' ||
    value === 'capitalize' ||
    value === 'uppercase' ||
    value === 'lowercase'
  ) {
    return value;
  }
  return undefined;
}

/** Borderless auto-sized inline editor positioned directly over a selected preview text node. */
export function InlineTextOverlay({
  request,
  busy = false,
  onDraftChange,
  onCommit,
  onCancel,
}: InlineTextOverlayProps) {
  const t = useT();
  const [value, setValue] = useState(request?.initialText ?? '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const settledRef = useRef(false);

  useEffect(() => {
    setValue(request?.initialText ?? '');
    composingRef.current = false;
    settledRef.current = false;
    if (!request) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [request]);

  useLayoutEffect(() => {
    void value;
    const el = textareaRef.current;
    if (!el || !request) return;
    el.style.height = 'auto';
    const nextHeight = Math.max(request.rect.height, el.scrollHeight);
    el.style.height = `${nextHeight}px`;
  });

  if (!request) return null;

  function settleCommit(nextValue: string) {
    if (settledRef.current || busy || !request) return;
    settledRef.current = true;
    if (nextValue === request.initialText) {
      onCancel();
      return;
    }
    void onCommit(nextValue);
  }

  function settleCancel() {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      composingRef.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      settleCancel();
      return;
    }
    if (event.key === 'Enter') {
      const hasModifier = event.metaKey || event.ctrlKey;
      if (hasModifier || (!event.shiftKey && !request?.multiline)) {
        event.preventDefault();
        event.stopPropagation();
        settleCommit(value);
      }
    }
  }

  const typo = request.typography;
  const textAlign = validTextAlign(typo?.textAlign);
  const textTransform = validTextTransform(typo?.textTransform);

  const textareaStyle: CSSProperties = {
    minWidth: Math.max(24, request.rect.width),
    minHeight: Math.max(20, request.rect.height),
    ...(typo?.fontFamily ? { fontFamily: typo.fontFamily } : {}),
    ...(typo?.fontSize ? { fontSize: typo.fontSize } : {}),
    ...(typo?.fontWeight ? { fontWeight: typo.fontWeight } : {}),
    ...(typo?.lineHeight ? { lineHeight: typo.lineHeight } : {}),
    ...(typo?.letterSpacing ? { letterSpacing: typo.letterSpacing } : {}),
    ...(typo?.color ? { color: typo.color } : {}),
    ...(typo?.padding ? { padding: typo.padding } : {}),
    ...(textAlign ? { textAlign } : {}),
    ...(textTransform ? { textTransform } : {}),
  };

  return (
    <div
      style={{
        top: request.rect.top,
        left: request.rect.left,
        width: Math.max(24, request.rect.width),
        minHeight: Math.max(20, request.rect.height),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="pointer-events-auto absolute z-40"
    >
      <textarea
        ref={textareaRef}
        aria-label={t('inspector.element.inlineEditorLabel')}
        disabled={busy}
        rows={1}
        value={value}
        style={textareaStyle}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const next = event.currentTarget.value;
          setValue(next);
          onDraftChange?.(next);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          onDraftChange?.(next);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (composingRef.current) return;
          settleCommit(value);
        }}
        className="m-0 block w-full resize-none overflow-hidden rounded-[var(--radius-sm)] border-0 bg-transparent outline outline-2 outline-[var(--color-accent)] focus:outline-2 focus:outline-[var(--color-accent)]"
      />
    </div>
  );
}
