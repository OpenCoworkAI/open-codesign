import { useT } from '@open-codesign/i18n';
import { ChevronDown, ChevronRight, Link2, Lock, RotateCcw, Unlink2, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { toNativeColorInputValue } from '../TweakPanel.inputs';
import {
  type FieldProvenance,
  formatLength,
  type ParsedLength,
  parseBox,
  parseLength,
} from './element-model';
import {
  type PaletteColor,
  paletteMatch,
  paletteSwatchSelected,
  parseTweakCssVar,
  tweakCssVarForToken,
} from './palette';

const INPUT_CLASS =
  'min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-[12px] text-[var(--color-text-primary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const MONO = { fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" } as const;

export function InspectorSection({
  title,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  onHoverChange,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onHoverChange?: ((hovering: boolean) => void) | undefined;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyVisible = collapsible ? open : true;

  return (
    <section
      className="border-t border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)] first:border-t-0"
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="flex min-w-0 flex-1 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] py-[2px] text-left hover:text-[var(--color-text-primary)]"
          >
            {open ? (
              <ChevronDown
                className="size-[12px] shrink-0 text-[var(--color-text-muted)]"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="size-[12px] shrink-0 text-[var(--color-text-muted)]"
                aria-hidden
              />
            )}
            <h4
              className="m-0 truncate text-[10px] font-medium uppercase text-[var(--color-text-muted)]"
              style={{ letterSpacing: 'var(--tracking-label)' }}
            >
              {title}
            </h4>
          </button>
        ) : (
          <h4
            className="m-0 text-[10px] font-medium uppercase text-[var(--color-text-muted)]"
            style={{ letterSpacing: 'var(--tracking-label)' }}
          >
            {title}
          </h4>
        )}
        {action}
      </div>
      {bodyVisible ? (
        <div className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)]">{children}</div>
      ) : null}
    </section>
  );
}

export function FieldRow({
  label,
  htmlFor,
  hint,
  provenance,
  provenanceTitle,
  onReset,
  resetLabel,
  isRemoved,
  hintId,
  children,
  onScrub,
}: {
  label: string;
  htmlFor?: string;
  hint?: string | undefined;
  provenance?: FieldProvenance | undefined;
  provenanceTitle?: string | undefined;
  onReset?: (() => void) | undefined;
  resetLabel?: string | undefined;
  isRemoved?: boolean | undefined;
  hintId?: string | undefined;
  children: ReactNode;
  /** Dragging the label horizontally nudges numeric fields, like design tools. */
  onScrub?: ((delta: number) => void) | undefined;
}) {
  const origin = useRef<number | null>(null);
  function down(event: PointerEvent<HTMLLabelElement>) {
    if (!onScrub || event.button !== 0) return;
    origin.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event: PointerEvent<HTMLLabelElement>) {
    if (!onScrub || origin.current === null) return;
    const steps = Math.trunc((event.clientX - origin.current) / 4);
    if (steps === 0) return;
    origin.current += steps * 4;
    onScrub(event.shiftKey ? steps * 10 : steps);
  }
  function up() {
    origin.current = null;
  }

  const labelTone =
    provenance === 'computed'
      ? 'text-[var(--color-text-muted)]'
      : 'text-[var(--color-text-secondary)]';

  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-start gap-[var(--space-2)]">
      <div className="flex min-w-0 items-center gap-[4px] pt-[6px]">
        {provenance === 'authored' ? (
          <span
            className="size-[5px] shrink-0 rounded-full bg-[var(--color-accent)]"
            title={provenanceTitle}
            aria-hidden="true"
          />
        ) : provenance === 'token' ? (
          <span
            className="size-[5px] shrink-0 rounded-full bg-[var(--color-mcp)]"
            title={provenanceTitle}
            aria-hidden="true"
          />
        ) : provenance === 'locked' ? (
          <Lock
            className="size-[10px] shrink-0 text-[var(--color-text-muted)]"
            aria-hidden="true"
          />
        ) : null}
        <label
          htmlFor={htmlFor}
          title={provenanceTitle ?? label}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={`min-w-0 truncate text-[12px] ${labelTone} ${isRemoved ? 'line-through opacity-60' : ''} ${onScrub ? 'cursor-ew-resize select-none' : ''}`}
        >
          {label}
        </label>
      </div>
      <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
        <div className="flex min-w-0 items-start gap-[var(--space-1)]">
          <div className={`min-w-0 flex-1 ${isRemoved ? 'opacity-50' : ''}`}>{children}</div>
          {onReset && resetLabel ? (
            <button
              type="button"
              onClick={onReset}
              aria-label={resetLabel}
              title={resetLabel}
              className="mt-[4px] inline-flex size-[20px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              {isRemoved ? (
                <RotateCcw className="size-[11px]" aria-hidden />
              ) : (
                <X className="size-[11px]" aria-hidden />
              )}
            </button>
          ) : null}
        </div>
        {hint ? (
          <p
            id={hintId}
            className="m-0 text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]"
          >
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TextField({
  id,
  value,
  onChange,
  disabled,
  multiline,
  placeholder,
  describedBy,
  mono,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  multiline?: boolean | undefined;
  placeholder?: string | undefined;
  describedBy?: string | undefined;
  mono?: boolean | undefined;
}) {
  if (!multiline)
    return (
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={describedBy}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT_CLASS} w-full`}
        style={mono ? MONO : undefined}
      />
    );
  return (
    <textarea
      id={id}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-describedby={describedBy}
      rows={Math.min(6, Math.max(1, Math.ceil(value.length / 28)))}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_CLASS} w-full resize-none leading-[var(--leading-snug)]`}
    />
  );
}

export function ColorField({
  id,
  label,
  value,
  onChange,
  disabled,
  palette,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  palette: readonly PaletteColor[];
  describedBy?: string | undefined;
}) {
  const t = useT();
  const match = paletteMatch(palette, value);
  const tweakVar = parseTweakCssVar(value);
  const [bindAsToken, setBindAsToken] = useState(tweakVar !== null);
  const visualColor =
    match && tweakVar !== null ? match.value : value.trim() ? value : 'transparent';
  const nativeValue =
    toNativeColorInputValue(match && tweakVar !== null ? match.value : value) ?? '#000000';
  const hasTokens = palette.some((color) => color.source === 'token');

  function toggleBindTokenMode() {
    const nextMode = !bindAsToken;
    setBindAsToken(nextMode);
    if (match?.source === 'token') {
      onChange(nextMode ? tweakCssVarForToken(match.name) : match.value);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1_5)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <label
          className={`relative inline-flex size-[28px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-inset-soft)] ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        >
          <span
            className="block size-full"
            style={{ backgroundColor: visualColor }}
            aria-hidden="true"
          />
          <input
            type="color"
            value={nativeValue}
            disabled={disabled}
            aria-label={t('tweaks.pickColor')}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer appearance-none border-0 p-0 opacity-0"
          />
        </label>
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className={`${INPUT_CLASS} ${tweakVar === null ? 'uppercase' : ''}`}
          style={MONO}
        />
        {match ? (
          <span
            className="shrink-0 rounded-full bg-[var(--color-accent-tint)] px-[6px] py-[1px] text-[10px] text-[var(--color-accent)]"
            title={t(`inspector.paletteSource.${match.source}`)}
          >
            {t('inspector.paletteMatch', { name: match.name })}
          </span>
        ) : null}
      </div>
      {palette.length > 0 ? (
        <div
          role="group"
          aria-label={t('inspector.paletteLabel')}
          className="flex flex-wrap items-center gap-[5px]"
        >
          {palette.map((color) => {
            const selected = paletteSwatchSelected(color, value);
            const name = color.name || color.value;
            return (
              <button
                key={`${color.source}:${color.value}:${color.name}`}
                type="button"
                disabled={disabled}
                title={`${name} · ${t(`inspector.paletteSource.${color.source}`)}`}
                aria-label={`${label}: ${name}`}
                aria-pressed={selected}
                onClick={(event) => {
                  if (color.source === 'token' && (bindAsToken || event.shiftKey)) {
                    onChange(tweakCssVarForToken(color.name));
                  } else {
                    onChange(color.value);
                  }
                }}
                className={`size-[18px] rounded-[4px] shadow-[var(--shadow-inset-soft)] transition-transform duration-[var(--duration-faster)] hover:scale-110 disabled:pointer-events-none disabled:opacity-50 ${selected ? 'outline outline-2 outline-offset-1 outline-[var(--color-accent)]' : ''}`}
                style={{ backgroundColor: color.value }}
              />
            );
          })}
          {hasTokens ? (
            <button
              type="button"
              disabled={disabled}
              aria-label={t('inspector.element.bindToken')}
              aria-pressed={bindAsToken}
              title={t('inspector.element.bindToken')}
              onClick={toggleBindTokenMode}
              className={`inline-flex h-[18px] items-center gap-[2px] rounded-[4px] border px-[5px] text-[10px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                bindAsToken
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-tint)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Link2 className="size-[10px]" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function nudge(value: string, delta: number, allowNegative = false): string {
  const parsed = parseLength(value);
  if (!parsed) return value;
  const amount = allowNegative ? parsed.amount + delta : Math.max(0, parsed.amount + delta);
  return formatLength({ ...parsed, amount });
}

function NumberCell({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
  allowNegative = false,
  describedBy,
}: {
  id?: string | undefined;
  value: ParsedLength;
  onChange: (next: ParsedLength) => void;
  disabled?: boolean | undefined;
  ariaLabel?: string | undefined;
  allowNegative?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const formatted = String(Math.round(value.amount * 100) / 100);
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    setEditing(null);
    const nextAmount = allowNegative ? value.amount + step : Math.max(0, value.amount + step);
    onChange({ ...value, amount: nextAmount });
  }
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] pr-[var(--space-2)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--color-accent)]">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        disabled={disabled}
        value={editing ?? formatted}
        onKeyDown={key}
        onBlur={() => setEditing(null)}
        onChange={(event) => {
          const raw = event.target.value;
          setEditing(raw);
          const trimmed = raw.trim();
          const amount = Number(trimmed);
          if (
            trimmed !== '' &&
            trimmed !== '-' &&
            Number.isFinite(amount) &&
            (allowNegative || amount >= 0)
          ) {
            onChange({ ...value, amount });
          }
        }}
        className="w-full min-w-0 bg-transparent px-[var(--space-2)] py-[6px] text-[12px] text-[var(--color-text-primary)] focus:outline-none disabled:opacity-50"
        style={MONO}
      />
      <span className="text-[11px] text-[var(--color-text-muted)]" style={MONO}>
        {value.unit || 'px'}
      </span>
    </div>
  );
}

/** A single length, e.g. font size or radius. Values like `auto` or `none` stay editable as text. */
export function LengthField({
  id,
  value,
  onChange,
  disabled,
  allowNegative = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  allowNegative?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const parsed = parseLength(value);
  const [stayText, setStayText] = useState(parsed === null);
  if (!parsed || stayText) {
    return (
      <div
        className="flex min-w-0 flex-1"
        onFocus={() => {
          if (!parsed) setStayText(true);
        }}
        onBlur={() => setStayText(false)}
      >
        <TextField
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          describedBy={describedBy}
          mono
        />
      </div>
    );
  }
  return (
    <NumberCell
      id={id}
      value={parsed}
      disabled={disabled}
      allowNegative={allowNegative}
      describedBy={describedBy}
      onChange={(next) => onChange(formatLength(next))}
    />
  );
}

export function lengthScrub(
  value: string,
  onChange: (next: string) => void,
  allowNegative = false,
) {
  return parseLength(value)
    ? (delta: number) => onChange(nudge(value, delta, allowNegative))
    : undefined;
}

const BOX_LABELS: Record<number, string[]> = {
  1: ['all'],
  2: ['vertical', 'horizontal'],
  3: ['top', 'horizontal', 'bottom'],
  4: ['top', 'right', 'bottom', 'left'],
};

/** CSS shorthand with one to four sides; allows toggling between uniform 1-value and 4-side edit. */
export function BoxField({
  id,
  value,
  onChange,
  disabled,
  allowNegative = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  allowNegative?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const t = useT();
  const generated = useId();
  const parts = parseBox(value);
  if (!parts) {
    return (
      <TextField
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        describedBy={describedBy}
        mono
      />
    );
  }
  const labels = BOX_LABELS[parts.length] ?? [];
  const isSingle = parts.length === 1;

  function toggleSplit() {
    const first = parts?.[0];
    if (!first) return;
    if (isSingle) {
      const side = formatLength(first);
      onChange(`${side} ${side} ${side} ${side}`);
    } else {
      onChange(formatLength(first));
    }
  }

  return (
    <div className="flex min-w-0 items-start gap-[var(--space-1)]">
      <div
        className={`grid min-w-0 flex-1 gap-[var(--space-1_5)] ${isSingle ? 'grid-cols-1' : 'grid-cols-2'}`}
      >
        {parts.map((part, index) => {
          const side = labels[index] ?? 'all';
          return (
            <NumberCell
              key={`${generated}:${parts.length}:${side}`}
              {...(index === 0 ? { id } : {})}
              ariaLabel={t(`inspector.box.${side}`)}
              value={part}
              disabled={disabled}
              allowNegative={allowNegative}
              describedBy={describedBy}
              onChange={(next) =>
                onChange(parts.map((item, i) => formatLength(i === index ? next : item)).join(' '))
              }
            />
          );
        })}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleSplit}
        aria-label={isSingle ? t('inspector.element.boxUnlink') : t('inspector.element.boxLink')}
        title={isSingle ? t('inspector.element.boxUnlink') : t('inspector.element.boxLink')}
        className="mt-[4px] inline-flex size-[20px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-40"
      >
        {isSingle ? (
          <Unlink2 className="size-[11px]" aria-hidden />
        ) : (
          <Link2 className="size-[11px]" aria-hidden />
        )}
      </button>
    </div>
  );
}

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function SegmentedControl({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  disabled,
}: {
  id?: string | undefined;
  ariaLabel: string;
  value: string;
  options: readonly SegmentedControlOption[];
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
}) {
  const normalized = value.trim().toLowerCase();
  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      className="inline-flex w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] p-[2px]"
    >
      {options.map((opt) => {
        const active = normalized === opt.value.toLowerCase();
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-label={opt.label}
            title={opt.label}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-[3px] truncate rounded-[var(--radius-sm)] px-[var(--space-1_5)] py-[4px] text-[11px] transition-colors duration-[var(--duration-faster)] disabled:pointer-events-none disabled:opacity-50 ${
              active
                ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {opt.icon ?? <span className="truncate">{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectFieldOption {
  value: string;
  label: string;
}

/** Accessible custom combobox/listbox avoiding native `<select>` elements. */
export function SelectField({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  ariaLabel: string;
  value: string;
  options: readonly SelectFieldOption[];
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const normalized = value.trim().toLowerCase();
  const matched = options.find((opt) => opt.value.toLowerCase() === normalized);
  const displayLabel = matched?.label ?? (value.trim() ? value : t('inspector.element.emptyValue'));

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full min-w-0 items-center justify-between gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-left text-[12px] text-[var(--color-text-primary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:outline focus:outline-1 focus:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{displayLabel}</span>
        <ChevronDown className="size-[12px] shrink-0 text-[var(--color-text-muted)]" aria-hidden />
      </button>
      {open && !disabled ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute right-0 left-0 z-20 mt-[var(--space-1)] flex max-h-[180px] flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--space-1)] shadow-[var(--shadow-elevated)]"
        >
          {options.map((opt) => {
            const selected = opt.value.toLowerCase() === normalized;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`truncate rounded-[var(--radius-sm)] px-[var(--space-2)] py-[5px] text-left text-[12px] transition-colors ${
                  selected
                    ? 'bg-[var(--color-accent-tint)] font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SliderNumberField({
  id,
  ariaLabel,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  ariaLabel: string;
  value: string;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
}) {
  const numeric = Number(value);
  const clamped = Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : max;
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex min-w-0 items-center gap-[var(--space-2)]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          setEditing(null);
          onChange(event.target.value);
        }}
        className="h-[18px] min-w-[48px] flex-1 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        id={id}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        value={editing ?? (value.trim() ? value : String(clamped))}
        onBlur={() => setEditing(null)}
        onChange={(event) => {
          const raw = event.target.value;
          setEditing(raw);
          const trimmed = raw.trim();
          const parsed = Number(trimmed);
          if (trimmed !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            onChange(String(parsed));
          }
        }}
        className="w-[46px] shrink-0 rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[6px] py-[5px] text-right text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none disabled:opacity-50"
        style={MONO}
      />
    </div>
  );
}
