/**
 * Converts CSS color values to the sRGB hex that DESIGN.md colors require.
 *
 * Handles hex, `rgb()`/`rgba()`, `hsl()`/`hsla()` and `oklch()`. A color with an alpha
 * below 1 or in another format is reported, never approximated. `oklch()` goes
 * OKLab → linear sRGB → gamma; a channel outside sRGB is clamped to [0, 1] and the
 * result says so, so the caller can show what changed.
 */

export type ColorConversion =
  | {
      ok: true;
      /** Lowercase `#rrggbb`. */
      hex: string;
      /** True when a channel was outside sRGB and was clamped, so the hex is not the exact color. */
      clamped: boolean;
    }
  | { ok: false; reason: 'alpha' | 'format' };

const FORMAT: ColorConversion = { ok: false, reason: 'format' };
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const COMPONENT_RE = new RegExp(`^(${NUMBER})(%|deg|grad|rad|turn)?$`, 'i');
// The body is matched greedily and split later, so whitespace has one way to match.
const FUNCTION_RE = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/i;
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

interface Component {
  value: number;
  unit: string;
}

const isNumber = (value: number | null | undefined): value is number => typeof value === 'number';

// `none` is the missing-component keyword; it converts as 0.
function parseComponent(raw: string): Component | null {
  if (raw.toLowerCase() === 'none') return { value: 0, unit: '' };
  const match = COMPONENT_RE.exec(raw);
  if (match === null) return null;
  return { value: Number(match[1]), unit: (match[2] ?? '').toLowerCase() };
}

function hueDegrees({ value, unit }: Component): number | null {
  if (unit === '' || unit === 'deg') return value;
  if (unit === 'grad') return value * 0.9;
  if (unit === 'rad') return (value * 180) / Math.PI;
  if (unit === 'turn') return value * 360;
  return null;
}

function alphaValue({ value, unit }: Component): number | null {
  if (unit === '') return value;
  return unit === '%' ? value / 100 : null;
}

interface ColorArguments {
  channels: string[];
  alpha?: string;
  /** The legacy comma syntax, where a fourth value is the alpha; `oklch()` has no such syntax. */
  comma: boolean;
}

/** Splits `a b c / d` and the legacy `a, b, c, d` into the channels and the optional alpha. */
function splitArguments(body: string): ColorArguments | null {
  if (body.includes(',')) {
    const parts = body.split(',').map((part) => part.trim());
    const alpha = parts.length === 4 ? parts[3] : undefined;
    const channels = alpha === undefined ? parts : parts.slice(0, 3);
    return alpha === undefined ? { channels, comma: true } : { channels, alpha, comma: true };
  }
  const sections = body.split('/').map((part) => part.trim());
  if (sections.length > 2) return null;
  const [channelText = '', alpha] = sections;
  const channels = channelText.split(/\s+/).filter((part) => part !== '');
  return alpha === undefined ? { channels, comma: false } : { channels, alpha, comma: false };
}

function hex(channels: [number, number, number]): ColorConversion {
  const clamped = channels.some((channel) => channel < 0 || channel > 255);
  const digits = channels
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0'))
    .join('');
  return { ok: true, hex: `#${digits}`, clamped };
}

const eightBit = (unit: number): number => Math.round(unit * 255);

function fromHex(digits: string): ColorConversion {
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  if (full.length === 8 && Number.parseInt(full.slice(6), 16) < 255) {
    return { ok: false, reason: 'alpha' };
  }
  return { ok: true, hex: `#${full.slice(0, 6).toLowerCase()}`, clamped: false };
}

function srgbChannel({ value, unit }: Component): number | null {
  if (unit === '%') return eightBit(value / 100);
  return unit === '' ? Math.round(value) : null;
}

function fromRgb(components: Component[]): ColorConversion {
  const [r, g, b] = components.map(srgbChannel);
  if (components.length !== 3 || !isNumber(r) || !isNumber(g) || !isNumber(b)) return FORMAT;
  return hex([r, g, b]);
}

function fromHsl(components: Component[]): ColorConversion {
  const [h, s, l] = components;
  if (components.length !== 3 || h === undefined || s?.unit !== '%' || l?.unit !== '%') {
    return FORMAT;
  }
  const degrees = hueDegrees(h);
  if (degrees === null) return FORMAT;
  const saturation = Math.max(0, Math.min(1, s.value / 100));
  const lightness = Math.max(0, Math.min(1, l.value / 100));
  const spread = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number): number => {
    const k = (((offset + degrees / 30) % 12) + 12) % 12;
    return lightness - spread * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return hex([eightBit(channel(0)), eightBit(channel(8)), eightBit(channel(4))]);
}

function gamma(linear: number): number {
  const magnitude = Math.abs(linear);
  const encoded =
    magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return Math.sign(linear) * encoded;
}

function fromOklch(components: Component[]): ColorConversion {
  const [lightness, chroma, hue] = components;
  if (
    components.length !== 3 ||
    lightness === undefined ||
    chroma === undefined ||
    hue === undefined
  ) {
    return FORMAT;
  }
  const degrees = hueDegrees(hue);
  const percentOrNumber = (c: Component) => c.unit === '' || c.unit === '%';
  if (degrees === null || !percentOrNumber(lightness) || !percentOrNumber(chroma)) return FORMAT;
  const L = lightness.unit === '%' ? lightness.value / 100 : lightness.value;
  const C = chroma.unit === '%' ? (chroma.value / 100) * 0.4 : chroma.value;
  const a = C * Math.cos((degrees * Math.PI) / 180);
  const b = C * Math.sin((degrees * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return hex([
    eightBit(gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    eightBit(gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    eightBit(gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ]);
}

export function cssColorToHex(value: string): ColorConversion {
  const text = value.trim();
  const hexMatch = HEX_RE.exec(text);
  if (hexMatch !== null) return fromHex(hexMatch[1] ?? '');

  const fn = FUNCTION_RE.exec(text);
  if (fn === null) return FORMAT;
  const name = (fn[1] ?? '').toLowerCase();
  const args = splitArguments(fn[2] ?? '');
  if (args === null || (args.comma && name === 'oklch')) return FORMAT;
  const { channels, alpha } = args;
  const components = channels.map(parseComponent).filter((c): c is Component => c !== null);
  if (components.length !== channels.length) return FORMAT;

  if (alpha !== undefined) {
    const parsed = parseComponent(alpha);
    const opacity = parsed === null ? null : alphaValue(parsed);
    if (opacity === null) return FORMAT;
    if (opacity < 1) return { ok: false, reason: 'alpha' };
  }

  if (name.startsWith('rgb')) return fromRgb(components);
  if (name.startsWith('hsl')) return fromHsl(components);
  return fromOklch(components);
}
