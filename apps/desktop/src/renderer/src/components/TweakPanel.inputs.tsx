import { useEffect, useState } from 'react';

export function isColorString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const color = value.trim();
  // CSS-wide keywords and unresolved variables are not concrete color tokens.
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(color) || /\bvar\(/i.test(color))
    return false;
  return typeof CSS !== 'undefined'
    ? CSS.supports('color', color)
    : expandHexColor(color) !== null || rgbFunctionalColorToHex(color) !== null;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function channelToHex(value: number): string {
  return clampChannel(value).toString(16).padStart(2, '0');
}

function expandHexColor(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const raw = match[1];
  if (!raw) return null;
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toLowerCase()}`;
  }
  return `#${raw.toLowerCase()}`;
}

function parseRgbChannel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const pct = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return (pct / 100) * 255;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function rgbFunctionalColorToHex(value: string): string | null {
  const match = value
    .trim()
    .match(
      /^rgba?\(\s*([+-]?\d*\.?\d+%?)\s*(?:,|\s)\s*([+-]?\d*\.?\d+%?)\s*(?:,|\s)\s*([+-]?\d*\.?\d+%?)(?:\s*(?:\/|,)\s*[^)]*)?\)$/i,
    );
  if (!match) return null;
  const channels = [match[1], match[2], match[3]].map((part) =>
    part === undefined ? null : parseRgbChannel(part),
  );
  if (channels.some((channel) => channel === null)) return null;
  return `#${channelToHex(channels[0] ?? 0)}${channelToHex(channels[1] ?? 0)}${channelToHex(channels[2] ?? 0)}`;
}

export function toNativeColorInputValue(value: string): string | null {
  return expandHexColor(value) ?? rgbFunctionalColorToHex(value);
}

export function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ColorSwatch({
  value,
  onChange,
  pickColorLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  pickColorLabel: string;
}) {
  const nativePickerValue = toNativeColorInputValue(value) ?? '#000000';
  const swatchClassName =
    'relative inline-flex h-[28px] w-[28px] shrink-0 cursor-pointer overflow-hidden rounded-[var(--radius-sm)] shadow-[var(--shadow-inset-soft)] transition-transform duration-[var(--duration-faster)] hover:scale-[1.04] active:scale-[var(--scale-press-down)]';
  const swatchFill = (
    <span className="block h-full w-full" style={{ backgroundColor: value }} aria-hidden="true" />
  );
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <label className={swatchClassName}>
        {swatchFill}
        <input
          type="color"
          value={nativePickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 p-0 opacity-0"
          aria-label={pickColorLabel}
        />
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-[12px] text-[var(--color-text-primary)] uppercase tracking-[0.04em] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none"
        style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full transition-colors duration-[var(--duration-fast)] ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-active)]'
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] rounded-full bg-[var(--color-surface)] shadow-[var(--shadow-soft)] transition-transform duration-[var(--duration-fast)] ${
          checked ? 'translate-x-[17px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (!Number.isNaN(n) && e.target.value.trim() !== '') onChange(n);
      }}
      className="w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-right text-[12px] text-[var(--color-text-primary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none"
      style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
    />
  );
}

export function RangeSlider({
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string | undefined;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[4px] min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-surface-active)] accent-[var(--color-accent)]"
      />
      <span
        className="min-w-[44px] text-right text-[11px] text-[var(--color-text-secondary)]"
        style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
      >
        {value}
        {unit ?? ''}
      </span>
    </div>
  );
}

export function SegmentedPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-hover)] p-[2px]">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            className={`flex-1 truncate rounded-[var(--radius-sm)] px-[var(--space-2)] py-[4px] text-[11px] transition-colors duration-[var(--duration-faster)] ${
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  mono = false,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  mono?: boolean;
  placeholder?: string | undefined;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      placeholder={placeholder}
      className="w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--color-surface-hover)] px-[var(--space-2)] py-[6px] text-[12px] text-[var(--color-text-primary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-active)] focus:border-[var(--color-accent)] focus:bg-[var(--color-surface)] focus:outline-none"
      style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}
    />
  );
}
