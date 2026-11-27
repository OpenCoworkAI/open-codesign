import { useT } from '@open-codesign/i18n';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { toNativeColorInputValue } from '../TweakPanel.inputs';
import { formatLength, type ParsedLength, parseBox, parseLength } from './element-model';
import { colorKey, type PaletteColor, paletteMatch } from './palette';

const INPUT_CLASS =
  'min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-[12px] text-[var(--color-text-primary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const MONO = { fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" } as const;

export function InspectorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)] first:border-t-0">
      <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-2)]">
        <h4
          className="m-0 text-[10px] font-medium uppercase text-[var(--color-text-muted)]"
          style={{ letterSpacing: 'var(--tracking-label)' }}
        >
          {title}
        </h4>
        {action}
      </div>
      <div className="flex flex-col gap-[var(--space-2)]">{children}</div>
    </section>
  );
}

export function FieldRow({
  label,
  htmlFor,
  hint,
  children,
  onScrub,
}: {
  label: string;
  htmlFor?: string;
  hint?: string | undefined;
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
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-[var(--space-2)]">
      <label
        htmlFor={htmlFor}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={`truncate pt-[6px] text-[12px] text-[var(--color-text-secondary)] ${onScrub ? 'cursor-ew-resize select-none' : ''}`}
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
        {children}
        {hint ? (
          <p className="m-0 text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]">
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
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  if (!multiline)
    return (
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
    );
  return (
    <textarea
      id={id}
      value={value}
      disabled={disabled}
      rows={Math.min(6, Math.max(1, Math.ceil(value.length / 28)))}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_CLASS} resize-none leading-[var(--leading-snug)]`}
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  palette: readonly PaletteColor[];
}) {
  const t = useT();
  const match = paletteMatch(palette, value);
  const valueKey = colorKey(value);
  const nativeValue = toNativeColorInputValue(value) ?? '#000000';
  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1_5)]">
      <div className="flex items-center gap-[var(--space-2)]">
        <label
          className={`relative inline-flex size-[28px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-inset-soft)] ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        >
          <span className="block size-full" style={{ backgroundColor: value }} aria-hidden="true" />
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
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className={`${INPUT_CLASS} uppercase`}
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
          className="flex flex-wrap gap-[5px]"
        >
          {palette.map((color) => {
            const selected = valueKey !== null && colorKey(color.value) === valueKey;
            const name = color.name || color.value;
            return (
              <button
                key={`${color.source}:${color.value}`}
                type="button"
                disabled={disabled}
                title={`${name} · ${t(`inspector.paletteSource.${color.source}`)}`}
                aria-label={`${label}: ${name}`}
                aria-pressed={selected}
                onClick={() => onChange(color.value)}
                className={`size-[18px] rounded-[4px] shadow-[var(--shadow-inset-soft)] transition-transform duration-[var(--duration-faster)] hover:scale-110 disabled:pointer-events-none disabled:opacity-50 ${selected ? 'outline outline-2 outline-offset-1 outline-[var(--color-accent)]' : ''}`}
                style={{ backgroundColor: color.value }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function nudge(value: string, delta: number): string {
  const parsed = parseLength(value);
  if (!parsed) return value;
  return formatLength({ ...parsed, amount: Math.max(0, parsed.amount + delta) });
}

function NumberCell({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: ParsedLength;
  onChange: (next: ParsedLength) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const formatted = String(Math.round(value.amount * 100) / 100);
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    setEditing(null);
    onChange({ ...value, amount: Math.max(0, value.amount + step) });
  }
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] pr-[var(--space-2)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--color-accent)]">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={editing ?? formatted}
        onKeyDown={key}
        onBlur={() => setEditing(null)}
        onChange={(event) => {
          const raw = event.target.value;
          setEditing(raw);
          const trimmed = raw.trim();
          const amount = Number(trimmed);
          if (trimmed !== '' && Number.isFinite(amount) && amount >= 0)
            onChange({ ...value, amount });
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

/** A single length, e.g. font size or radius. Values like `none` stay editable as text. */
export function LengthField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const parsed = parseLength(value);
  if (!parsed)
    return <TextField id={id} value={value} onChange={onChange} disabled={disabled ?? false} />;
  return (
    <NumberCell
      id={id}
      value={parsed}
      disabled={disabled ?? false}
      onChange={(next) => onChange(formatLength(next))}
    />
  );
}

export function lengthScrub(value: string, onChange: (next: string) => void) {
  return parseLength(value) ? (delta: number) => onChange(nudge(value, delta)) : undefined;
}

const BOX_LABELS: Record<number, string[]> = {
  1: ['all'],
  2: ['vertical', 'horizontal'],
  3: ['top', 'horizontal', 'bottom'],
  4: ['top', 'right', 'bottom', 'left'],
};

/** CSS shorthand with one to four sides; the existing side count is preserved. */
export function BoxField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const generated = useId();
  const parts = parseBox(value);
  if (!parts)
    return <TextField id={id} value={value} onChange={onChange} disabled={disabled ?? false} />;
  const labels = BOX_LABELS[parts.length] ?? [];
  return (
    <div className="grid grid-cols-2 gap-[var(--space-1_5)]">
      {parts.map((part, index) => {
        const side = labels[index] ?? 'all';
        return (
          <NumberCell
            key={`${generated}:${side}`}
            {...(index === 0 ? { id } : {})}
            ariaLabel={t(`inspector.box.${side}`)}
            value={part}
            disabled={disabled ?? false}
            onChange={(next) =>
              onChange(parts.map((item, i) => formatLength(i === index ? next : item)).join(' '))
            }
          />
        );
      })}
    </div>
  );
}
