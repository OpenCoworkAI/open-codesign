import type { DesignMdBodySection, DesignMdFrontmatter, DesignToken } from '@open-codesign/shared';
import { cssColorToHex } from './color.js';

/**
 * Maps extracted design tokens to the fields `validateDesignMd` accepts.
 *
 * Pure: nothing is logged. What could not be mapped, what was clamped and what was left out
 * come back in `report`, so the caller can show each one instead of changing values silently.
 */

export interface TokenFile {
  /** Path shown to the user, relative to the folder that was scanned. */
  path: string;
  tokens: DesignToken[];
}

export type DesignFields = Pick<
  DesignMdFrontmatter,
  'colors' | 'typography' | 'rounded' | 'spacing'
>;

export interface ImportOrigin {
  /** The file the value came from. */
  source: string;
  /** The token's name in that file. */
  token: string;
}

export type UnsupportedReason = 'color-alpha' | 'color-format' | 'dimension' | 'type';

export interface TokenImportReport {
  /** Colors outside sRGB, clamped. `original` is the value as written, with `var()` replaced. */
  clamped: Array<{ path: string; original: string; hex: string } & ImportOrigin>;
  /** Values DESIGN.md cannot hold: alpha, another color format, a unit it does not take. */
  unsupported: Array<{ reason: UnsupportedReason; value: string } & ImportOrigin>;
  /** A `var()` that points at no scanned token, or at itself. */
  unresolved: Array<{ reason: 'undefined' | 'cycle'; value: string } & ImportOrigin>;
  /** Values declared in a theme block other than the default one. */
  otherThemes: Array<{ block: string; value: string } & ImportOrigin>;
  /** A second value for a name already taken; the first one is kept. */
  shadowed: Array<{ path: string; value: string; kept: ImportOrigin } & ImportOrigin>;
}

export interface TokenImport {
  fields: DesignFields;
  /** Font sizes, line heights and shadows, which the frontmatter has no field for. */
  sections: DesignMdBodySection[];
  /** Where every mapped value came from, keyed like `colors.brand-500`. */
  origins: Record<string, ImportOrigin>;
  report: TokenImportReport;
}

const DIMENSION = /^-?\d+(?:\.\d+)?(?:px|em|rem)$/;
const UNITLESS = /^-?\d+(?:\.\d+)?$/;

// The words each extractor puts in front of a token's own name: `colors.brand.500` (v3),
// `color-brand-500` (v4), `font-family-sans` (CSS variables), `fontSize.lg`.
const NAME_PREFIX: Partial<Record<DesignToken['type'], RegExp>> = {
  color: /^(?:colors?|palette)(?:[.-]|$)/,
  fontFamily: /^(?:font-family|fontFamily|font|typeface)(?:[.-]|$)/,
  fontSize: /^(?:font-size|fontSize|text-size|text)(?:[.-]|$)/,
  lineHeight: /^(?:line-height|lineHeight|leading)(?:[.-]|$)/,
  radius: /^(?:border-radius|borderRadius|radius|rounded)(?:[.-]|$)/,
  spacing: /^(?:spacing|space)(?:[.-]|$)/,
  shadow: /^(?:box-shadow|boxShadow|shadow|elevation)(?:[.-]|$)/,
};

/** `--spacing` and `--radius` alone name the base unit, so the prefix is all there is. */
function tokenKey(name: string, type: DesignToken['type']): string {
  const companion = type === 'lineHeight' ? /^text-(.+)--line-height$/.exec(name) : null;
  const stripped = companion?.[1] ?? name.replace(NAME_PREFIX[type] ?? '', '');
  const key = stripped.replace(/\./g, '-');
  return key === '' ? 'base' : key;
}

type Resolved = { ok: true; value: string } | { ok: false; reason: 'undefined' | 'cycle' };

/** Replaces each `var(--name, fallback)` with the scanned token it names. */
function resolveVars(value: string, lookup: Map<string, string>, chain: string[]): Resolved {
  let out = '';
  let from = 0;
  while (from < value.length) {
    const start = value.indexOf('var(', from);
    if (start === -1) {
      out += value.slice(from);
      break;
    }
    out += value.slice(from, start);
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < value.length; i++) {
      if (value[i] === '(') depth += 1;
      else if (value[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return { ok: false, reason: 'undefined' };
    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim().replace(/^--/, '');
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
    if (chain.includes(name)) return { ok: false, reason: 'cycle' };
    const target = lookup.get(name);
    const source = target ?? fallback;
    if (source === undefined) return { ok: false, reason: 'undefined' };
    const resolved = resolveVars(source, lookup, [...chain, name]);
    if (!resolved.ok) return resolved;
    out += resolved.value;
    from = end + 1;
  }
  return { ok: true, value: out };
}

export function mapTokensToDesignFields(files: TokenFile[]): TokenImport {
  // Only the default block defines a name that `var()` can point at; the first definition wins.
  const lookup = new Map<string, string>();
  for (const file of files) {
    for (const token of file.tokens) {
      if (token.block === undefined && !lookup.has(token.name)) lookup.set(token.name, token.value);
    }
  }

  const colors: Record<string, string> = {};
  const typography: Record<string, { fontFamily: string }> = {};
  const rounded: Record<string, string> = {};
  const spacing: Record<string, string | number> = {};
  const typographyLines: string[] = [];
  const elevationLines: string[] = [];
  const origins: Record<string, ImportOrigin> = {};
  const report: TokenImportReport = {
    clamped: [],
    unsupported: [],
    unresolved: [],
    otherThemes: [],
    shadowed: [],
  };
  const claimed = new Map<string, { value: string; origin: ImportOrigin }>();

  // True when `path` is free, so the caller writes the value. The same value again is ignored;
  // a different one is reported and the first stays.
  const claim = (path: string, value: string, origin: ImportOrigin): boolean => {
    const earlier = claimed.get(path);
    if (earlier === undefined) {
      claimed.set(path, { value, origin });
      origins[path] = origin;
      return true;
    }
    if (earlier.value !== value) {
      report.shadowed.push({ path, value, kept: earlier.origin, ...origin });
    }
    return false;
  };

  for (const file of files) {
    for (const token of file.tokens) {
      const origin = { source: file.path, token: token.name };
      const unsupported = (reason: UnsupportedReason) =>
        report.unsupported.push({ reason, value: token.value, ...origin });

      if (token.block !== undefined) {
        report.otherThemes.push({ block: token.block, value: token.value, ...origin });
        continue;
      }
      const resolved = resolveVars(token.value, lookup, [token.name]);
      if (!resolved.ok) {
        report.unresolved.push({ reason: resolved.reason, value: token.value, ...origin });
        continue;
      }
      const value = resolved.value.trim();
      const key = tokenKey(token.name, token.type);

      switch (token.type) {
        case 'color': {
          const color = cssColorToHex(value);
          if (!color.ok) {
            unsupported(color.reason === 'alpha' ? 'color-alpha' : 'color-format');
          } else if (claim(`colors.${key}`, color.hex, origin)) {
            colors[key] = color.hex;
            if (color.clamped) {
              report.clamped.push({
                path: `colors.${key}`,
                original: value,
                hex: color.hex,
                ...origin,
              });
            }
          }
          break;
        }
        case 'fontFamily':
          if (claim(`typography.${key}`, value, origin)) typography[key] = { fontFamily: value };
          break;
        case 'radius': {
          const dimension = value === '0' ? '0px' : value;
          if (!DIMENSION.test(dimension)) unsupported('dimension');
          else if (claim(`rounded.${key}`, dimension, origin)) rounded[key] = dimension;
          break;
        }
        case 'spacing':
          if (DIMENSION.test(value)) {
            if (claim(`spacing.${key}`, value, origin)) spacing[key] = value;
          } else if (UNITLESS.test(value)) {
            if (claim(`spacing.${key}`, value, origin)) spacing[key] = Number(value);
          } else {
            unsupported('dimension');
          }
          break;
        case 'fontSize':
        case 'lineHeight': {
          const label = token.type === 'fontSize' ? 'font size' : 'line height';
          const valid =
            DIMENSION.test(value) || (token.type === 'lineHeight' && UNITLESS.test(value));
          if (!valid) unsupported('dimension');
          else if (claim(`Typography.${label}.${key}`, value, origin)) {
            typographyLines.push(`- ${label} \`${key}\`: ${value}`);
          }
          break;
        }
        case 'shadow': {
          const shadow = value.replace(/\s+/g, ' ');
          if (claim(`Elevation & Depth.${key}`, shadow, origin)) {
            elevationLines.push(`- \`${key}\`: ${shadow}`);
          }
          break;
        }
        default:
          unsupported('type');
      }
    }
  }

  const fields: DesignFields = {};
  if (Object.keys(colors).length > 0) fields.colors = colors;
  if (Object.keys(typography).length > 0) fields.typography = typography;
  if (Object.keys(rounded).length > 0) fields.rounded = rounded;
  if (Object.keys(spacing).length > 0) fields.spacing = spacing;

  const sections: DesignMdBodySection[] = [];
  if (typographyLines.length > 0) {
    sections.push({ heading: 'Typography', content: typographyLines.join('\n') });
  }
  if (elevationLines.length > 0) {
    sections.push({ heading: 'Elevation & Depth', content: elevationLines.join('\n') });
  }
  return { fields, sections, origins, report };
}
