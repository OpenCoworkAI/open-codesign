import { createHash } from 'node:crypto';
import {
  type SourceEditApplyResultV1,
  SourceEditAttributeName,
  type SourceEditInspectResultV1,
  SourceEditOperation,
  type SourceEditPatch,
  type SourceEditRejectedV1,
  type SourceEditScope,
  type SourceEditSelectionMode,
  type SourceEditStyleBinding,
  SourceEditStyleProperty,
  type SourceEditTarget,
  type SourceEditUnsupported,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import { decodeHtmlEntities } from '@open-codesign/shared/html-utils';
import { type DefaultTreeAdapterTypes, parse, parseFragment } from 'parse5';

export const SVG_VECTOR_TAGS = new Set([
  'svg',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'g',
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'use',
  'stop',
  'linearGradient',
  'radialGradient',
]);

const EXCLUDED_HTML_TAGS = new Set([
  'html',
  'head',
  'script',
  'style',
  'meta',
  'link',
  'base',
  'iframe',
  'noscript',
  'object',
  'embed',
  'template',
]);

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const HTML_LENGTH_PROPERTIES = new Set<SourceEditStyleProperty>([
  'fontSize',
  'letterSpacing',
  'padding',
  'margin',
  'gap',
  'width',
  'height',
  'maxWidth',
  'minHeight',
  'borderWidth',
  'borderRadius',
]);

const COLOR_PROPERTIES = new Set<SourceEditStyleProperty>([
  'color',
  'background',
  'backgroundColor',
  'borderColor',
]);

const DISPLAY_VALUES = new Set([
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'none',
  'contents',
]);
const FLEX_DIRECTION_VALUES = new Set(['row', 'row-reverse', 'column', 'column-reverse']);
const JUSTIFY_CONTENT_VALUES = new Set([
  'flex-start',
  'flex-end',
  'center',
  'space-between',
  'space-around',
  'space-evenly',
  'start',
  'end',
]);
const ALIGN_ITEMS_VALUES = new Set([
  'stretch',
  'flex-start',
  'flex-end',
  'center',
  'baseline',
  'start',
  'end',
]);
const FLEX_WRAP_VALUES = new Set(['nowrap', 'wrap', 'wrap-reverse']);
const FONT_WEIGHT_WORDS = new Set(['normal', 'bold', 'medium', 'semibold']);
const TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);
const TEXT_TRANSFORM_VALUES = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const OVERFLOW_VALUES = new Set(['visible', 'hidden', 'scroll', 'auto', 'clip']);
const OBJECT_FIT_VALUES = new Set(['contain', 'cover', 'fill', 'none', 'scale-down']);

const CSS_VAR_RE = /^var\(--[A-Za-z0-9_-]+\)$/;
const HEX_COLOR_RE = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const NAMED_COLOR_RE = /^[a-z]+$/i;
const SAFE_COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'color-mix']);
const SAFE_GRADIENT_FUNCS = new Set([
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
]);
const SAFE_MATH_FUNCS = new Set(['calc', 'clamp']);
const SAFE_GRID_FUNCS = new Set(['repeat', 'minmax', 'fit-content', 'calc', 'clamp', 'var']);
const CSS_LENGTH_UNITS = '(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex|svh|dvh|lvh)';

export function rejectEdit(reason: string, message: string): SourceEditRejectedV1 {
  return { schemaVersion: 1, status: 'rejected', reason, message };
}

export function sha256Hex(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function minimalPatch(before: string, after: string): SourceEditPatch {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    start,
    end: beforeEnd,
    expectedText: before.slice(start, beforeEnd),
    replacement: after.slice(start, afterEnd),
  };
}

// The existing preview still scans raw source for these controls, even in strings.
export function runtimeReservedValue(value: string): boolean {
  if (value.includes('ReactDOM.createRoot')) return true;
  if (
    [
      '<!-- AGENT_BODY_BEGIN -->',
      '<!-- AGENT_BODY_END -->',
      '<!-- CODESIGN_OVERLAY_SCRIPT -->',
      '<!-- CODESIGN_JSX_RUNTIME -->',
      '<!-- CODESIGN_STANDALONE_RUNTIME -->',
      '<!-- OPEN-CODESIGN-PREVIEW-VIEWPORT -->',
    ].some((marker) => value.includes(marker))
  )
    return true;
  if (/\/\*\s*(?:EDITMODE|TWEAK-SCHEMA)-(?:BEGIN|END)\s*\*\//.test(value)) return true;
  if (/(?:^|[^A-Za-z0-9_$])(?:function|const|let)\s+(?:App|_App)(?=$|[^A-Za-z0-9_$])/.test(value))
    return true;
  for (const match of value.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    const marker = match[1]?.replace(/\s/g, '');
    if (/^(?:EDITMODE|TWEAK-SCHEMA)-(?:BEGIN|END)$/.test(marker ?? '')) return true;
  }
  return false;
}

export function extractCssVarTokenName(value: string): string | undefined {
  const tweak = /var\(--ocd-tweak-([A-Za-z0-9_-]+)\)/.exec(value);
  if (tweak?.[1]) return tweak[1];
  const generic = /var\(--([A-Za-z0-9_-]+)\)/.exec(value);
  return generic?.[1];
}

function stripControlAndWhitespace(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) continue;
    out += value[i] ?? '';
  }
  return out;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validAttributeValue(name: SourceEditAttributeName, value: string): boolean {
  if (name !== 'href' && name !== 'src') return true;
  const candidates = [value, decodeHtmlEntities(value)];
  for (const candidate of candidates) {
    const compacted = stripControlAndWhitespace(candidate);
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(compacted);
    if (!match?.[1]) continue;
    const scheme = match[1].toLowerCase();
    if (scheme === 'javascript' || scheme === 'vbscript' || scheme === 'file') return false;
    if (scheme === 'data') {
      if (name !== 'src' || !/^data:image\//i.test(compacted)) return false;
      continue;
    }
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto' && scheme !== 'tel') {
      return false;
    }
    if ((scheme === 'mailto' || scheme === 'tel') && name !== 'href') return false;
  }
  return true;
}

export function canUpsertAttributeForTag(tagName: string, name: SourceEditAttributeName): boolean {
  const tag = tagName.toLowerCase();
  switch (name) {
    case 'title':
    case 'aria-label':
      return true;
    case 'href':
      return tag === 'a' || tag === 'area';
    case 'src':
      return (
        tag === 'img' ||
        tag === 'video' ||
        tag === 'audio' ||
        tag === 'source' ||
        tag === 'track' ||
        tag === 'input'
      );
    case 'alt':
      return tag === 'img' || tag === 'area' || tag === 'input';
    case 'placeholder':
      return tag === 'input' || tag === 'textarea';
  }
}

function hasBalancedParens(value: string, requireOuterEnvelope = false): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
      if (requireOuterEnvelope && depth === 0 && i !== value.length - 1) return false;
    }
  }
  return depth === 0;
}

function hasBalancedBrackets(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function splitTopLevelCssTokens(value: string): string[] | null {
  const tokens: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (depth === 0 && /\s/.test(ch ?? '')) {
      if (start >= 0) {
        tokens.push(value.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (depth !== 0) return null;
  if (start >= 0) tokens.push(value.slice(start));
  return tokens;
}

function splitTopLevelCommas(value: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) return null;
  parts.push(value.slice(start).trim());
  return parts;
}

function validateFunctions(value: string, allowedFunctions: ReadonlySet<string>): boolean {
  const callRe = /([A-Za-z_-][A-Za-z0-9_-]*)\s*\(/g;
  for (const match of value.matchAll(callRe)) {
    const name = match[1]?.toLowerCase() ?? '';
    if (!allowedFunctions.has(name)) return false;
    if (name === 'var') {
      const openIdx = match.index + match[0].length - 1;
      const closeIdx = value.indexOf(')', openIdx + 1);
      if (closeIdx < 0) return false;
      const varSlice = value.slice(match.index, closeIdx + 1);
      if (!CSS_VAR_RE.test(varSlice)) return false;
    }
  }
  return true;
}

function isSafeMathExpr(value: string): boolean {
  const openMatch = /^(calc|clamp)\(/i.exec(value);
  if (!openMatch?.[1] || !value.endsWith(')') || !hasBalancedParens(value, true)) return false;
  const stack: Array<'calc' | 'clamp' | 'group'> = [openMatch[1].toLowerCase() as 'calc' | 'clamp'];
  let cursor = openMatch[0].length;
  let hasOperand = false;
  const clampCommas: number[] = [0];

  while (cursor < value.length - 1) {
    const ch = value[cursor] ?? '';
    if (/\s/.test(ch)) {
      cursor += 1;
      continue;
    }
    if (ch === '(') {
      stack.push('group');
      clampCommas.push(0);
      cursor += 1;
      continue;
    }
    if (ch === ')') {
      const top = stack.pop();
      const commas = clampCommas.pop() ?? 0;
      if (!top) return false;
      if (top === 'clamp' && commas !== 2) return false;
      cursor += 1;
      continue;
    }
    if (ch === ',') {
      if (stack[stack.length - 1] !== 'clamp') return false;
      clampCommas[clampCommas.length - 1] = (clampCommas[clampCommas.length - 1] ?? 0) + 1;
      cursor += 1;
      continue;
    }
    if ('+-*/'.includes(ch)) {
      cursor += 1;
      continue;
    }
    const sub = value.slice(cursor);
    const fnCall = /^(calc|clamp)\(/i.exec(sub);
    if (fnCall?.[1]) {
      stack.push(fnCall[1].toLowerCase() as 'calc' | 'clamp');
      clampCommas.push(0);
      cursor += fnCall[0].length;
      continue;
    }
    const varCall = /^var\(--[A-Za-z0-9_-]+\)/.exec(sub);
    if (varCall) {
      hasOperand = true;
      cursor += varCall[0].length;
      continue;
    }
    const numUnit = new RegExp(
      `^(?:\\d+(?:\\.\\d+)?|\\.\\d+)${CSS_LENGTH_UNITS}?(?=$|[\\s+\\-*/(),])`,
      'i',
    ).exec(sub);
    if (numUnit && Number.isFinite(Number.parseFloat(numUnit[0]))) {
      hasOperand = true;
      cursor += numUnit[0].length;
      continue;
    }
    return false;
  }

  if (stack.length !== 1) return false;
  if (stack[0] === 'clamp' && clampCommas[0] !== 2) return false;
  return hasOperand;
}

function isLengthToken(token: string, allowNegative: boolean): boolean {
  if (CSS_VAR_RE.test(token)) return true;
  if (/^(?:calc|clamp)\(/i.test(token)) return isSafeMathExpr(token);
  const pattern = new RegExp(
    `^${allowNegative ? '-?' : ''}(?:\\d+(?:\\.\\d+)?|\\.\\d+)${CSS_LENGTH_UNITS}?$`,
    'i',
  );
  return pattern.test(token) && Number.isFinite(Number.parseFloat(token));
}

function isSafeColorToken(value: string): boolean {
  if (CSS_VAR_RE.test(value)) return true;
  if (HEX_COLOR_RE.test(value) || NAMED_COLOR_RE.test(value)) return true;
  const fn = /^([a-z-]+)\(/i.exec(value);
  if (!fn?.[1]) return false;
  const fnName = fn[1].toLowerCase();
  if (!SAFE_COLOR_FUNCS.has(fnName) || !hasBalancedParens(value, true)) return false;
  if (!/^[\da-zA-Z\s.,%#()/+_-]+$/.test(value)) return false;
  return validateFunctions(value, new Set([...SAFE_COLOR_FUNCS, 'var', ...SAFE_MATH_FUNCS]));
}

export function validStyle(property: string, value: string): boolean {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 1_000 ||
    hasControlChar(value) ||
    /[\\;{}<>]|\/\*|\*\//.test(value) ||
    /(?:expression|url)\s*\(|(?:javascript|vbscript)\s*:/i.test(value)
  ) {
    return false;
  }

  const parsedProp = SourceEditStyleProperty.safeParse(property);
  if (!parsedProp.success) return false;
  const prop = parsedProp.data;

  if (COLOR_PROPERTIES.has(prop)) {
    if (isSafeColorToken(value)) return true;
    if (prop === 'background') {
      const layers = splitTopLevelCommas(value);
      if (!layers || layers.some((layer) => layer.length === 0)) return false;
      return layers.every((layer) => {
        if (isSafeColorToken(layer)) return true;
        const fn = /^([a-z-]+)\(/i.exec(layer);
        if (!fn?.[1] || !SAFE_GRADIENT_FUNCS.has(fn[1].toLowerCase())) return false;
        if (!hasBalancedParens(layer, true)) return false;
        if (!/^[\da-zA-Z\s.,%#()/+_-]+$/.test(layer)) return false;
        return validateFunctions(
          layer,
          new Set([...SAFE_GRADIENT_FUNCS, ...SAFE_COLOR_FUNCS, ...SAFE_MATH_FUNCS, 'var']),
        );
      });
    }
    return false;
  }

  switch (prop) {
    case 'opacity':
      if (CSS_VAR_RE.test(value)) return true;
      if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 && n <= 1;
      }
      if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(value)) {
        const n = Number.parseFloat(value);
        return Number.isFinite(n) && n >= 0 && n <= 100;
      }
      return false;
    case 'lineHeight':
      return value === 'normal' || isLengthToken(value, false);
    case 'letterSpacing':
      return value === 'normal' || isLengthToken(value, true);
    case 'fontSize':
      return isLengthToken(value, false);
    case 'width':
    case 'height':
    case 'minHeight':
      return value === 'auto' || isLengthToken(value, false);
    case 'maxWidth':
      return value === 'none' || value === 'auto' || isLengthToken(value, false);
    case 'padding':
    case 'borderRadius':
    case 'borderWidth': {
      const parts = splitTopLevelCssTokens(value);
      if (!parts || parts.length === 0 || parts.length > 4) return false;
      return parts.every(
        (part) =>
          (prop === 'borderWidth' && ['thin', 'medium', 'thick'].includes(part)) ||
          isLengthToken(part, false),
      );
    }
    case 'margin': {
      const parts = splitTopLevelCssTokens(value);
      if (!parts || parts.length === 0 || parts.length > 4) return false;
      return parts.every((part) => part === 'auto' || isLengthToken(part, true));
    }
    case 'gap': {
      const parts = splitTopLevelCssTokens(value);
      if (!parts || parts.length === 0 || parts.length > 2) return false;
      return parts.every((part) => isLengthToken(part, false));
    }
    case 'display':
      return DISPLAY_VALUES.has(value);
    case 'flexDirection':
      return FLEX_DIRECTION_VALUES.has(value);
    case 'justifyContent':
      return JUSTIFY_CONTENT_VALUES.has(value);
    case 'alignItems':
      return ALIGN_ITEMS_VALUES.has(value);
    case 'flexWrap':
      return FLEX_WRAP_VALUES.has(value);
    case 'fontWeight':
      return (
        CSS_VAR_RE.test(value) || FONT_WEIGHT_WORDS.has(value) || /^(?:[1-8]\d{2}|900)$/.test(value)
      );
    case 'textAlign':
      return TEXT_ALIGN_VALUES.has(value);
    case 'textTransform':
      return TEXT_TRANSFORM_VALUES.has(value);
    case 'overflow':
      return OVERFLOW_VALUES.has(value);
    case 'objectFit':
      return OBJECT_FIT_VALUES.has(value);
    case 'fontFamily': {
      if (CSS_VAR_RE.test(value)) return true;
      const parts = splitTopLevelCommas(value);
      if (!parts || parts.length === 0 || parts.some((part) => part.length === 0)) return false;
      return parts.every(
        (part) =>
          CSS_VAR_RE.test(part) ||
          /^(?:"[A-Za-z0-9\s_-]+"|'[A-Za-z0-9\s_-]+'|[A-Za-z0-9\s_-]+)$/.test(part),
      );
    }
    case 'border':
    case 'boxShadow':
      if (value === 'none' || CSS_VAR_RE.test(value)) return true;
      return (
        hasBalancedParens(value) &&
        /^[\da-zA-Z\s.,%#()/+_-]+$/.test(value) &&
        validateFunctions(value, new Set([...SAFE_COLOR_FUNCS, ...SAFE_MATH_FUNCS, 'var']))
      );
    case 'gridTemplateColumns':
      if (value === 'none' || value === 'auto' || CSS_VAR_RE.test(value)) return true;
      return (
        hasBalancedParens(value) &&
        hasBalancedBrackets(value) &&
        /^[\da-zA-Z\s.,%()[\]/+_-]+$/.test(value) &&
        validateFunctions(value, SAFE_GRID_FUNCS)
      );
    default:
      return false;
  }
}

interface CssDecl {
  rawName: string;
  cssName: string;
  property?: SourceEditStyleProperty;
  value: string;
  important: boolean;
}

function toCssKebab(property: SourceEditStyleProperty): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toCamelStyleProperty(cssName: string): SourceEditStyleProperty | undefined {
  const camel = cssName
    .trim()
    .toLowerCase()
    .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  const parsed = SourceEditStyleProperty.safeParse(camel);
  return parsed.success ? parsed.data : undefined;
}

function parseCssDeclarations(cssText: string): CssDecl[] {
  const chunks: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < cssText.length; i += 1) {
    const ch = cssText[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    else if (ch === ';' && depth === 0) {
      chunks.push(cssText.slice(start, i));
      start = i + 1;
    }
  }
  chunks.push(cssText.slice(start));

  const decls: CssDecl[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    let colonIdx = -1;
    let d = 0;
    let q: '"' | "'" | null = null;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (q) {
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") q = ch;
      else if (ch === '(') d += 1;
      else if (ch === ')' && d > 0) d -= 1;
      else if (ch === ':' && d === 0) {
        colonIdx = i;
        break;
      }
    }
    if (colonIdx <= 0) continue;
    const rawName = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();
    const important = /\s*!important$/i.test(rawValue);
    const value = rawValue.replace(/\s*!important$/i, '').trim();
    const cssName = rawName.toLowerCase();
    const property = toCamelStyleProperty(cssName);
    decls.push({
      rawName,
      cssName,
      ...(property ? { property } : {}),
      value,
      important,
    });
  }
  return decls;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scanStartTagAttributes(startTagSource: string): {
  rawTagName: string;
  attrNames: string[];
  hasDuplicates: boolean;
  selfClosing: boolean;
} {
  let i = 1; // skip '<'
  const len = startTagSource.length;
  while (i < len && !/[\s/>]/.test(startTagSource[i] ?? '')) i += 1;
  const rawTagName = startTagSource.slice(1, i);
  const attrNames: string[] = [];
  const seen = new Set<string>();
  let hasDuplicates = false;

  while (i < len) {
    while (i < len && /\s/.test(startTagSource[i] ?? '')) i += 1;
    if (i >= len || startTagSource[i] === '>' || startTagSource.slice(i, i + 2) === '/>') break;
    if (startTagSource[i] === '/') {
      i += 1;
      continue;
    }
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(startTagSource[i] ?? '')) i += 1;
    const rawName = startTagSource.slice(nameStart, i);
    const lowerName = rawName.toLowerCase();
    if (lowerName) {
      if (seen.has(lowerName)) hasDuplicates = true;
      seen.add(lowerName);
      attrNames.push(lowerName);
    }
    while (i < len && /\s/.test(startTagSource[i] ?? '')) i += 1;
    if (startTagSource[i] === '=') {
      i += 1;
      while (i < len && /\s/.test(startTagSource[i] ?? '')) i += 1;
      const quote = startTagSource[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        while (i < len && startTagSource[i] !== quote) i += 1;
        if (i < len) i += 1;
      } else {
        while (i < len && !/[\s>]/.test(startTagSource[i] ?? '')) i += 1;
      }
    }
  }
  const selfClosing = startTagSource.endsWith('/>');
  return { rawTagName, attrNames, hasDuplicates, selfClosing };
}

function htmlProblem(
  field: SourceEditUnsupported['field'],
  reason: string,
  message: string,
): SourceEditUnsupported {
  return { field, reason, message };
}

function htmlOpeningProblem(
  element: DefaultTreeAdapterTypes.Element,
  startTagSource: string,
): SourceEditUnsupported | undefined {
  const tag = element.tagName.toLowerCase();
  if (tag.includes('-') || EXCLUDED_HTML_TAGS.has(tag)) {
    return htmlProblem(
      'target',
      'unsupported-host',
      'Custom elements and executable/raw-content hosts are not editable.',
    );
  }
  const scanned = scanStartTagAttributes(startTagSource);
  if (scanned.hasDuplicates) {
    return htmlProblem(
      'target',
      'duplicate-attributes',
      'Duplicate HTML attributes are not editable.',
    );
  }
  for (const name of scanned.attrNames) {
    if (/^data-(?:codesign|ocd)(?:-|$)/i.test(name)) {
      return htmlProblem(
        'target',
        'reserved-provenance',
        'Reserved preview provenance attributes cannot be authored or edited.',
      );
    }
    if (name === 'is' || name === 'contenteditable') {
      return htmlProblem(
        'target',
        'mutable-host',
        'Customized or user-mutable host content is not a static source boundary.',
      );
    }
  }
  return undefined;
}

interface HtmlTextSpan {
  kind: 'set-text';
  textId?: string;
  value: string;
  start: number;
  end: number;
}

interface HtmlAttrSpan {
  kind: 'attr';
  name: SourceEditAttributeName;
  value: string;
  start: number;
  end: number;
}

interface HtmlStyleEntry {
  property: SourceEditStyleProperty;
  value: string;
}

interface HtmlLocatedTarget {
  target: SourceEditTarget;
  textSpans: HtmlTextSpan[];
  attrSpans: Map<SourceEditAttributeName, HtmlAttrSpan>;
  classAttrSpan?: { start: number; end: number; value: string };
  styleAttrSpan?: { start: number; end: number; value: string; decls: CssDecl[] };
  styleEntries: Map<SourceEditStyleProperty, HtmlStyleEntry>;
  prevSibling?: { start: number; end: number };
  nextSibling?: { start: number; end: number };
  selfClosing: boolean;
}

interface HtmlAnalysis {
  sourceHash: string;
  targets: HtmlLocatedTarget[];
}

function isElement(
  node: DefaultTreeAdapterTypes.ChildNode,
): node is DefaultTreeAdapterTypes.Element {
  return 'tagName' in node;
}

function isTextNode(
  node: DefaultTreeAdapterTypes.ChildNode,
): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function isHtmlFullDocument(source: string): boolean {
  const withoutBom = source.startsWith('\uFEFF') ? source.slice(1) : source;
  return /^\s*(?:<!doctype|<html\b|<head\b|<body\b)/i.test(withoutBom);
}

function parseHtmlTree(source: string) {
  return isHtmlFullDocument(source)
    ? parse(source, { sourceCodeLocationInfo: true })
    : parseFragment(source, { sourceCodeLocationInfo: true });
}

function isMeaningfulHtmlSibling(node: DefaultTreeAdapterTypes.ChildNode): boolean {
  if (!isElement(node)) return false;
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag) return false;
  const tag = node.tagName.toLowerCase();
  if (EXCLUDED_HTML_TAGS.has(tag)) return false;
  const isSvgInternal = node.namespaceURI === 'http://www.w3.org/2000/svg' && tag !== 'svg';
  if (isSvgInternal) return false;
  return Boolean(loc.endTag) || VOID_HTML_TAGS.has(tag) || loc.startTag.endOffset === loc.endOffset;
}

function removeAttrRange(
  source: string,
  attrStart: number,
  attrEnd: number,
): {
  start: number;
  end: number;
} {
  let start = attrStart;
  let end = attrEnd;
  // Prefer removing one preceding horizontal space when multiple attributes or end of tag follow.
  const lineStart =
    Math.max(source.lastIndexOf('\n', attrStart - 1), source.lastIndexOf('\r', attrStart - 1)) + 1;
  const beforeOnLine = source.slice(lineStart, attrStart);
  const afterOnLineEnd = (() => {
    const lf = source.indexOf('\n', attrEnd);
    const cr = source.indexOf('\r', attrEnd);
    if (lf < 0 && cr < 0) return source.length;
    if (lf < 0) return cr;
    if (cr < 0) return lf;
    return Math.min(lf, cr);
  })();
  const afterOnLine = source.slice(attrEnd, afterOnLineEnd);

  if (
    /^[ \t]+$/.test(beforeOnLine) &&
    /^[ \t]*$/.test(afterOnLine) &&
    afterOnLineEnd < source.length
  ) {
    const eolLen = source[afterOnLineEnd] === '\r' && source[afterOnLineEnd + 1] === '\n' ? 2 : 1;
    return { start: lineStart, end: afterOnLineEnd + eolLen };
  }
  if (source[start - 1] === ' ' || source[start - 1] === '\t') {
    start -= 1;
  } else if (source[end] === ' ' || source[end] === '\t') {
    end += 1;
  }
  return { start, end };
}

function normalizeHtmlStyleValue(property: SourceEditStyleProperty, value: string): string {
  if (
    HTML_LENGTH_PROPERTIES.has(property) &&
    /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) &&
    Number(value) !== 0
  ) {
    return `${value}px`;
  }
  return value;
}

function analyzeHtml(
  path: string,
  source: string,
  selectionMode: SourceEditSelectionMode = 'preview',
): HtmlAnalysis | SourceEditRejectedV1 {
  if (selectionMode === 'source') {
    return rejectEdit(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  }
  if (!/\.(html|htm)$/i.test(path)) {
    return rejectEdit('unsupported-path', 'Source editing requires a real HTML, JSX, or TSX file.');
  }
  if (
    source.includes('<!-- AGENT_BODY_BEGIN -->') ||
    source.includes('<!-- CODESIGN_OVERLAY_SCRIPT -->') ||
    source.includes('<!-- CODESIGN_JSX_RUNTIME -->') ||
    source.includes('<!-- CODESIGN_STANDALONE_RUNTIME -->')
  ) {
    return rejectEdit('unsupported-source', 'Wrapped preview output cannot be edited directly.');
  }

  const root = parseHtmlTree(source);
  const targets: HtmlLocatedTarget[] = [];

  function visitNode(
    current: DefaultTreeAdapterTypes.ParentNode,
    inheritedBoundary?: SourceEditUnsupported,
  ): void {
    const childNodes = current.childNodes;
    const elementSiblings = childNodes.filter(isMeaningfulHtmlSibling);

    for (const child of childNodes) {
      if (!isElement(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'html') {
        visitNode(child, inheritedBoundary);
        continue;
      }
      if (EXCLUDED_HTML_TAGS.has(tag)) continue;

      const isSvgNamespace = child.namespaceURI === 'http://www.w3.org/2000/svg';
      if (isSvgNamespace && tag !== 'svg') continue; // Exclude SVG internals

      const loc = child.sourceCodeLocation;
      if (!loc?.startTag) {
        // Implicit html/head/body added by parse5 — traverse authored children without emitting wrapper.
        visitNode(child, inheritedBoundary);
        continue;
      }

      const startTagSource = source.slice(loc.startTag.startOffset, loc.startTag.endOffset);
      const scanned = scanStartTagAttributes(startTagSource);
      const ownProblem = htmlOpeningProblem(child, startTagSource);
      const boundary = inheritedBoundary ?? ownProblem;
      const isSvg = tag === 'svg' || SVG_VECTOR_TAGS.has(tag);

      const hasExplicitEnd = Boolean(loc.endTag) || VOID_HTML_TAGS.has(tag) || scanned.selfClosing;
      const insertionOffset = scanned.selfClosing
        ? loc.startTag.endOffset - 2
        : loc.startTag.endOffset - 1;
      const id = `${loc.startOffset}:${loc.endOffset}`;
      const unsupported: SourceEditUnsupported[] = [];
      const editableFields: SourceEditTarget['editableFields'] = [];
      const textSpans: HtmlTextSpan[] = [];
      const textSources: NonNullable<SourceEditTarget['textSources']> = [];
      const textLayout: NonNullable<SourceEditTarget['textLayout']> = [];
      const attrSpans = new Map<SourceEditAttributeName, HtmlAttrSpan>();
      const styleBindings: SourceEditStyleBinding[] = [];
      const styleEntries = new Map<SourceEditStyleProperty, HtmlStyleEntry>();

      let classAttrSpan: HtmlLocatedTarget['classAttrSpan'];
      let styleAttrSpan: HtmlLocatedTarget['styleAttrSpan'];
      let directText: string | undefined = '';

      if (boundary) {
        unsupported.push(boundary);
      } else {
        // Text children
        const meaningfulChildren = child.childNodes.filter((n) => {
          if (n.nodeName === '#comment') return false;
          if (isTextNode(n)) {
            return n.value.replace(/^\uFEFF/, '').trim().length !== 0;
          }
          return true;
        });

        for (const sub of meaningfulChildren) {
          if (isElement(sub)) {
            const subLoc = sub.sourceCodeLocation;
            const subTag = sub.tagName.toLowerCase();
            const isValidChildTarget =
              Boolean(subLoc?.startTag) &&
              !EXCLUDED_HTML_TAGS.has(subTag) &&
              !(sub.namespaceURI === 'http://www.w3.org/2000/svg' && subTag !== 'svg');
            textLayout.push(
              isValidChildTarget && subLoc
                ? { kind: 'element', targetId: `${subLoc.startOffset}:${subLoc.endOffset}` }
                : { kind: 'dynamic' },
            );
            continue;
          }
          if (isTextNode(sub)) {
            const tLoc = sub.sourceCodeLocation;
            if (!tLoc) {
              textLayout.push({ kind: 'dynamic' });
              directText = undefined;
              continue;
            }
            const textValue = sub.value;
            if (directText !== undefined) directText += textValue;
            const textId =
              meaningfulChildren.length === 1 ? undefined : `${tLoc.startOffset}:${tLoc.endOffset}`;
            textLayout.push(
              textValue.length <= 100_000
                ? { kind: 'text', value: textValue, ...(textId ? { textId } : {}) }
                : { kind: 'dynamic' },
            );
            const op: SourceEditTarget['editableFields'][number] = {
              kind: 'set-text',
              value: textValue,
              ...(textId ? { textId } : {}),
            };
            if (SourceEditOperation.safeParse(op).success) {
              editableFields.push(op);
              textSpans.push({
                kind: 'set-text',
                ...(textId ? { textId } : {}),
                value: textValue,
                start: tLoc.startOffset,
                end: tLoc.endOffset,
              });
              textSources.push({
                ...(textId ? { textId } : {}),
                start: tLoc.startOffset,
                end: tLoc.endOffset,
                origin: 'HTML text definition',
              });
            }
          }
        }
        if (textSpans.length === 0) {
          unsupported.push(
            htmlProblem(
              'text',
              'non-static-text',
              'This element has no directly owned text. Select its text-bearing child.',
            ),
          );
        }

        // Attributes
        for (const attr of child.attrs) {
          const attrName = attr.name.toLowerCase();
          const attrLoc = loc.attrs?.[attrName];
          if (!attrLoc) continue;
          if (attrName === 'class') {
            classAttrSpan = {
              start: attrLoc.startOffset,
              end: attrLoc.endOffset,
              value: attr.value,
            };
            continue;
          }
          if (attrName === 'style') {
            const decls = parseCssDeclarations(attr.value);
            styleAttrSpan = {
              start: attrLoc.startOffset,
              end: attrLoc.endOffset,
              value: attr.value,
              decls,
            };
            const lastByProp = new Map<SourceEditStyleProperty, CssDecl>();
            for (const decl of decls) {
              if (decl.property) lastByProp.set(decl.property, decl);
            }
            for (const [prop, decl] of lastByProp) {
              const tokenName = extractCssVarTokenName(decl.value);
              const isValidStatic = !decl.important && validStyle(prop, decl.value);
              if (isValidStatic) {
                styleEntries.set(prop, { property: prop, value: decl.value });
                const op = { kind: 'set-style' as const, property: prop, value: decl.value };
                if (SourceEditOperation.safeParse(op).success) editableFields.push(op);
              }
              if (tokenName || !isValidStatic) {
                styleBindings.push({
                  property: prop,
                  expression: decl.value.slice(0, 1_000),
                  ...(tokenName ? { tokenName } : {}),
                  editable: isValidStatic,
                });
              }
            }
            continue;
          }
          const parsedAttr = SourceEditAttributeName.safeParse(attrName);
          if (parsedAttr.success) {
            const op = {
              kind: 'set-attribute' as const,
              name: parsedAttr.data,
              value: attr.value,
            };
            if (SourceEditOperation.safeParse(op).success) {
              editableFields.push(op);
              attrSpans.set(parsedAttr.data, {
                kind: 'attr',
                name: parsedAttr.data,
                value: attr.value,
                start: attrLoc.startOffset,
                end: attrLoc.endOffset,
              });
            }
          }
        }
      }

      const parentIsRootFragment = current.nodeName === '#document-fragment';
      const parentIsContainerElement =
        isElement(current as DefaultTreeAdapterTypes.ChildNode) &&
        !['html', 'head'].includes(
          (current as DefaultTreeAdapterTypes.Element).tagName.toLowerCase(),
        );
      const canStruct =
        !boundary &&
        tag !== 'body' &&
        hasExplicitEnd &&
        (parentIsRootFragment || parentIsContainerElement);
      const siblingIdx = canStruct ? elementSiblings.indexOf(child) : -1;
      const prevEl = siblingIdx > 0 ? elementSiblings[siblingIdx - 1] : undefined;
      const nextEl =
        siblingIdx >= 0 && siblingIdx < elementSiblings.length - 1
          ? elementSiblings[siblingIdx + 1]
          : undefined;

      const prevSibling = prevEl?.sourceCodeLocation
        ? { start: prevEl.sourceCodeLocation.startOffset, end: prevEl.sourceCodeLocation.endOffset }
        : undefined;
      const nextSibling = nextEl?.sourceCodeLocation
        ? { start: nextEl.sourceCodeLocation.startOffset, end: nextEl.sourceCodeLocation.endOffset }
        : undefined;

      const classValue =
        classAttrSpan && classAttrSpan.value.length <= 4_000 ? classAttrSpan.value : undefined;

      targets.push({
        target: {
          id,
          tagName: tag,
          start: loc.startOffset,
          end: loc.endOffset,
          insertionOffset,
          scope: 'source-definition',
          editableFields,
          ...(directText !== undefined ? { directText } : {}),
          textSources,
          textLayout,
          unsupported,
          capabilities: {
            canUpsertStyle: !boundary && !isSvg,
            canUpsertAttribute: !boundary && !isSvg,
            canEditClassName: !boundary && (!isSvg || classAttrSpan !== undefined),
            canReorderUp: Boolean(prevSibling),
            canReorderDown: Boolean(nextSibling),
            canDuplicate: canStruct,
            canDelete: canStruct,
            sharedDefinition: false,
            styleMode: 'html',
          },
          ...(styleBindings.length > 0 ? { styleBindings } : {}),
          ...(classValue !== undefined ? { className: classValue } : {}),
          sourceLocation: {
            startLine: loc.startLine,
            startCol: loc.startCol,
            endLine: loc.endLine,
            endCol: loc.endCol,
          },
        },
        textSpans,
        attrSpans,
        ...(classAttrSpan ? { classAttrSpan } : {}),
        ...(styleAttrSpan ? { styleAttrSpan } : {}),
        styleEntries,
        ...(prevSibling ? { prevSibling } : {}),
        ...(nextSibling ? { nextSibling } : {}),
        selfClosing: scanned.selfClosing,
      });

      if (tag !== 'svg') visitNode(child, boundary);
    }
  }

  visitNode(root);

  if (
    targets.length > 10_000 ||
    targets.some(({ target }) => (target.textLayout?.length ?? 0) > 10_000)
  ) {
    return rejectEdit(
      'unsupported-targets',
      'This source exceeds the supported preview target or text-layout limit.',
    );
  }

  return { sourceHash: sha256Hex(source), targets };
}

export function analyzeHtmlSourceEdit(input: {
  path: string;
  source: string;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditInspectResultV1 {
  const result = analyzeHtml(input.path, input.source, input.selectionMode);
  if ('status' in result) return result;
  return {
    schemaVersion: 1,
    status: 'ready',
    path: input.path,
    sourceHash: result.sourceHash,
    targets: result.targets.map(({ target }) => target),
  };
}

function serializeHtmlStyleAttribute(decls: readonly CssDecl[]): string {
  const joined = decls.map((d) => `${d.rawName}: ${d.value}`).join('; ');
  return `style="${escapeHtmlAttr(joined)}"`;
}

function applyHtmlStyleSet(
  source: string,
  located: HtmlLocatedTarget,
  property: SourceEditStyleProperty,
  value: string,
): { start: number; end: number; replacement: string } {
  const normalizedValue = normalizeHtmlStyleValue(property, value);
  const cssName = toCssKebab(property);
  const conflictName =
    property === 'backgroundColor'
      ? 'background'
      : property === 'background'
        ? 'background-color'
        : undefined;

  if (!located.styleAttrSpan) {
    const offset = located.target.insertionOffset;
    const needsLeadingSpace = !/\s/.test(source[offset - 1] ?? '');
    const needsTrailingSpace = located.selfClosing && /\s/.test(source[offset - 1] ?? '');
    const attrText = `${needsLeadingSpace ? ' ' : ''}${serializeHtmlStyleAttribute([
      { rawName: cssName, cssName, property, value: normalizedValue, important: false },
    ])}${needsTrailingSpace ? ' ' : ''}`;
    return { start: offset, end: offset, replacement: attrText };
  }

  const nextDecls: CssDecl[] = [];
  let replaced = false;
  for (const decl of located.styleAttrSpan.decls) {
    if (decl.cssName === cssName) {
      if (!replaced) {
        nextDecls.push({
          rawName: decl.rawName,
          cssName,
          property,
          value: normalizedValue,
          important: false,
        });
        replaced = true;
      }
      continue;
    }
    if (conflictName && decl.cssName === conflictName) {
      if (!replaced) {
        nextDecls.push({
          rawName: cssName,
          cssName,
          property,
          value: normalizedValue,
          important: false,
        });
        replaced = true;
      }
      continue;
    }
    nextDecls.push(decl);
  }
  if (!replaced) {
    nextDecls.push({
      rawName: cssName,
      cssName,
      property,
      value: normalizedValue,
      important: false,
    });
  }
  return {
    start: located.styleAttrSpan.start,
    end: located.styleAttrSpan.end,
    replacement: serializeHtmlStyleAttribute(nextDecls),
  };
}

function applyHtmlStyleRemove(
  source: string,
  located: HtmlLocatedTarget,
  property: SourceEditStyleProperty,
): { start: number; end: number; replacement: string } | null {
  if (!located.styleAttrSpan) return null;
  const cssName = toCssKebab(property);
  if (!located.styleAttrSpan.decls.some((decl) => decl.cssName === cssName)) return null;
  const remaining = located.styleAttrSpan.decls.filter((decl) => decl.cssName !== cssName);
  if (remaining.length === 0) {
    const range = removeAttrRange(source, located.styleAttrSpan.start, located.styleAttrSpan.end);
    return { start: range.start, end: range.end, replacement: '' };
  }
  return {
    start: located.styleAttrSpan.start,
    end: located.styleAttrSpan.end,
    replacement: serializeHtmlStyleAttribute(remaining),
  };
}

function planHtmlSingleEdit(
  source: string,
  located: HtmlLocatedTarget,
  op: SourceEditOperation,
): { patch: SourceEditPatch } | SourceEditRejectedV1 {
  const caps = located.target.capabilities;
  switch (op.kind) {
    case 'set-text': {
      const span = located.textSpans.find((item) => item.textId === op.textId);
      if (!span) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'This static text field is not editable.',
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text that cannot be saved.',
        );
      }
      const replacement = escapeHtmlText(op.value);
      return {
        patch: {
          start: span.start,
          end: span.end,
          expectedText: source.slice(span.start, span.end),
          replacement,
        },
      };
    }
    case 'set-attribute': {
      if (!validAttributeValue(op.name, op.value)) {
        return rejectEdit(
          'invalid-operation',
          `Unsafe URL scheme in ${op.name} attribute is not allowed.`,
        );
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text that cannot be saved.',
        );
      }
      const existing = located.attrSpans.get(op.name);
      if (existing) {
        const replacement = `${op.name}="${escapeHtmlAttr(op.value)}"`;
        return {
          patch: {
            start: existing.start,
            end: existing.end,
            expectedText: source.slice(existing.start, existing.end),
            replacement,
          },
        };
      }
      if (!caps?.canUpsertAttribute || !canUpsertAttributeForTag(located.target.tagName, op.name)) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ?? 'Attribute insertion is not supported here.',
        );
      }
      const offset = located.target.insertionOffset;
      const needsLeadingSpace = !/\s/.test(source[offset - 1] ?? '');
      const needsTrailingSpace = located.selfClosing && /\s/.test(source[offset - 1] ?? '');
      const replacement = `${needsLeadingSpace ? ' ' : ''}${op.name}="${escapeHtmlAttr(op.value)}"${needsTrailingSpace ? ' ' : ''}`;
      return {
        patch: {
          start: offset,
          end: offset,
          expectedText: '',
          replacement,
        },
      };
    }
    case 'remove-attribute': {
      const existing = located.attrSpans.get(op.name);
      if (!existing || located.target.unsupported.some((item) => item.field === 'target')) {
        return rejectEdit('unsupported-field', 'This attribute is not present on the element.');
      }
      const range = removeAttrRange(source, existing.start, existing.end);
      return {
        patch: {
          start: range.start,
          end: range.end,
          expectedText: source.slice(range.start, range.end),
          replacement: '',
        },
      };
    }
    case 'set-style': {
      if (!validStyle(op.property, op.value)) {
        return rejectEdit('invalid-style', 'Unsupported or unsafe CSS style value.');
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text that cannot be saved.',
        );
      }
      const hasExisting = located.styleEntries.has(op.property);
      if (!hasExisting && !caps?.canUpsertStyle) {
        return rejectEdit(
          'unsupported-field',
          located.target.unsupported[0]?.message ??
            'Style upsert is not supported on this element.',
        );
      }
      const edit = applyHtmlStyleSet(source, located, op.property, op.value);
      return {
        patch: {
          start: edit.start,
          end: edit.end,
          expectedText: source.slice(edit.start, edit.end),
          replacement: edit.replacement,
        },
      };
    }
    case 'remove-style': {
      if (located.target.unsupported.some((item) => item.field === 'target')) {
        return rejectEdit('unsupported-field', 'This element is not editable.');
      }
      const edit = applyHtmlStyleRemove(source, located, op.property);
      if (!edit) {
        return rejectEdit(
          'unsupported-field',
          'This style property is not present on the element.',
        );
      }
      return {
        patch: {
          start: edit.start,
          end: edit.end,
          expectedText: source.slice(edit.start, edit.end),
          replacement: edit.replacement,
        },
      };
    }
    case 'set-class-name': {
      if (!caps?.canEditClassName) {
        return rejectEdit('unsupported-field', 'Class editing is not supported on this element.');
      }
      if (runtimeReservedValue(op.value)) {
        return rejectEdit(
          'runtime-reserved-value',
          'This value contains preview runtime control text that cannot be saved.',
        );
      }
      if (located.classAttrSpan) {
        return {
          patch: {
            start: located.classAttrSpan.start,
            end: located.classAttrSpan.end,
            expectedText: source.slice(located.classAttrSpan.start, located.classAttrSpan.end),
            replacement: `class="${escapeHtmlAttr(op.value)}"`,
          },
        };
      }
      const offset = located.target.insertionOffset;
      const needsLeadingSpace = !/\s/.test(source[offset - 1] ?? '');
      const needsTrailingSpace = located.selfClosing && /\s/.test(source[offset - 1] ?? '');
      return {
        patch: {
          start: offset,
          end: offset,
          expectedText: '',
          replacement: `${needsLeadingSpace ? ' ' : ''}class="${escapeHtmlAttr(op.value)}"${needsTrailingSpace ? ' ' : ''}`,
        },
      };
    }
    case 'toggle-visibility': {
      if (op.hidden) {
        if (!located.styleEntries.has('display') && !caps?.canUpsertStyle) {
          return rejectEdit('unsupported-field', 'Visibility toggling is not supported here.');
        }
        const edit = applyHtmlStyleSet(source, located, 'display', 'none');
        return {
          patch: {
            start: edit.start,
            end: edit.end,
            expectedText: source.slice(edit.start, edit.end),
            replacement: edit.replacement,
          },
        };
      }
      if (located.styleEntries.get('display')?.value === 'none') {
        const edit = applyHtmlStyleRemove(source, located, 'display');
        if (edit) {
          return {
            patch: {
              start: edit.start,
              end: edit.end,
              expectedText: source.slice(edit.start, edit.end),
              replacement: edit.replacement,
            },
          };
        }
      }
      return { patch: { start: 0, end: 0, expectedText: '', replacement: '' } };
    }
    case 'duplicate-element': {
      if (op.itemIndex !== undefined || !caps?.canDuplicate) {
        return rejectEdit('unsupported-field', 'This HTML element cannot be duplicated.');
      }
      const elementText = source.slice(located.target.start, located.target.end);
      const lastNewline = source.lastIndexOf('\n', located.target.start - 1);
      const prefix = source.slice(lastNewline + 1, located.target.start);
      const eol = lastNewline > 0 && source[lastNewline - 1] === '\r' ? '\r\n' : '\n';
      const replacement =
        lastNewline >= 0 && /^[ \t]*$/.test(prefix) ? `${eol}${prefix}${elementText}` : elementText;
      return {
        patch: {
          start: located.target.end,
          end: located.target.end,
          expectedText: '',
          replacement,
        },
      };
    }
    case 'delete-element': {
      if (op.itemIndex !== undefined || !caps?.canDelete) {
        return rejectEdit('unsupported-field', 'This HTML element cannot be deleted.');
      }
      const lastLf = source.lastIndexOf('\n', located.target.start - 1);
      const lineStart = lastLf + 1;
      const before = source.slice(lineStart, located.target.start);
      const nextLf = source.indexOf('\n', located.target.end);
      const nextCr = source.indexOf('\r', located.target.end);
      const lineEnd =
        nextLf < 0 && nextCr < 0
          ? source.length
          : nextLf < 0
            ? nextCr
            : nextCr < 0
              ? nextLf
              : Math.min(nextLf, nextCr);
      const after = source.slice(located.target.end, lineEnd);
      if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after) && lineEnd < source.length) {
        const eolLen = source[lineEnd] === '\r' && source[lineEnd + 1] === '\n' ? 2 : 1;
        return {
          patch: {
            start: lineStart,
            end: lineEnd + eolLen,
            expectedText: source.slice(lineStart, lineEnd + eolLen),
            replacement: '',
          },
        };
      }
      let start = located.target.start;
      const end = located.target.end;
      if (source[start - 1] === ' ' && source[end] === ' ') start -= 1;
      return {
        patch: {
          start,
          end,
          expectedText: source.slice(start, end),
          replacement: '',
        },
      };
    }
    case 'reorder-sibling': {
      if (op.itemIndex !== undefined) {
        return rejectEdit('unsupported-field', 'HTML elements do not support map item reordering.');
      }
      const pair =
        op.direction === 'up'
          ? located.prevSibling
            ? {
                a: located.prevSibling,
                b: { start: located.target.start, end: located.target.end },
              }
            : null
          : located.nextSibling
            ? {
                a: { start: located.target.start, end: located.target.end },
                b: located.nextSibling,
              }
            : null;
      if (!pair) {
        return rejectEdit(
          'unsupported-field',
          'This HTML element cannot be reordered in that direction.',
        );
      }
      const aText = source.slice(pair.a.start, pair.a.end);
      const mid = source.slice(pair.a.end, pair.b.start);
      const bText = source.slice(pair.b.start, pair.b.end);
      return {
        patch: {
          start: pair.a.start,
          end: pair.b.end,
          expectedText: source.slice(pair.a.start, pair.b.end),
          replacement: `${bText}${mid}${aText}`,
        },
      };
    }
    case 'set-map-item-text':
      return rejectEdit('unsupported-field', 'HTML elements do not support map item text edits.');
  }
}

export function planHtmlSourceEdit(input: {
  path: string;
  source: string;
  expectedSourceHash: string;
  targetId: string;
  operation: SourceEditOperation;
  scope: SourceEditScope;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditApplyResultV1 {
  if (input.selectionMode === 'source') {
    return rejectEdit(
      'source-mode-removed',
      'Source-list editing has been removed. Select the element in the current preview.',
    );
  }
  if (input.scope !== 'source-definition') {
    return rejectEdit(
      'invalid-scope',
      'Only source-definition editing is supported, not an arbitrary selected instance.',
    );
  }
  const operation = SourceEditOperation.safeParse(input.operation);
  if (!operation.success) {
    return rejectEdit('invalid-operation', 'Only allowlisted literal operations are supported.');
  }
  if (sha256Hex(input.source) !== input.expectedSourceHash) {
    return rejectEdit(
      'stale-source',
      'The source changed; inspect the current file before editing.',
    );
  }
  const analysis = analyzeHtml(input.path, input.source, input.selectionMode);
  if ('status' in analysis) return analysis;
  const located = analysis.targets.find(({ target }) => target.id === input.targetId);
  if (!located) {
    return rejectEdit(
      'invalid-target',
      'The target does not identify an HTML host element in the current source.',
    );
  }
  const planned = planHtmlSingleEdit(input.source, located, operation.data);
  if ('status' in planned) return planned;
  const content =
    input.source.slice(0, planned.patch.start) +
    planned.patch.replacement +
    input.source.slice(planned.patch.end);
  try {
    parseHtmlTree(content);
  } catch {
    return rejectEdit('reparse-failed', 'The patched HTML failed parsing; no content was applied.');
  }
  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content,
    sourceHash: sha256Hex(content),
    patch: planned.patch,
    scope: 'source-definition',
  };
}

export function planHtmlSourceEditBatch(input: {
  path: string;
  source: string;
  expectedSourceHash: string;
  targetId: string;
  operations: readonly SourceEditOperation[];
  scope: SourceEditScope;
  selectionMode?: SourceEditSelectionMode | undefined;
}): SourceEditApplyResultV1 {
  const keys = input.operations.map((operation) => {
    const parsed = SourceEditOperation.safeParse(operation);
    return parsed.success ? sourceEditFieldKey(parsed.data) : null;
  });
  if (keys.some((key) => key === null) || new Set(keys).size !== keys.length) {
    return rejectEdit('invalid-operation', 'Each field may appear at most once in a batch.');
  }
  if (
    input.operations.length > 1 &&
    input.operations.some((op) =>
      ['duplicate-element', 'delete-element', 'reorder-sibling'].includes(op.kind),
    )
  ) {
    return rejectEdit(
      'invalid-operation',
      'Structural operations cannot be combined with other operations in a single batch.',
    );
  }
  if (input.scope !== 'source-definition') {
    return rejectEdit(
      'invalid-scope',
      'Only source-definition editing is supported, not an arbitrary selected instance.',
    );
  }
  if (sha256Hex(input.source) !== input.expectedSourceHash) {
    return rejectEdit(
      'stale-source',
      'The source changed; inspect the current file before editing.',
    );
  }
  const first = analyzeHtml(input.path, input.source, input.selectionMode);
  if ('status' in first) return first;
  const index = first.targets.findIndex(({ target }) => target.id === input.targetId);
  const initial = first.targets[index];
  if (!initial) {
    return rejectEdit(
      'invalid-target',
      'The target does not identify an HTML host element in the current source.',
    );
  }
  const initialTextIds = initial.textSpans.map((span) => span.textId);
  const textOrdinals = input.operations.map((operation) =>
    operation.kind === 'set-text' ? initialTextIds.indexOf(operation.textId) : -1,
  );
  if (
    input.operations.some((operation, i) => operation.kind === 'set-text' && textOrdinals[i] === -1)
  ) {
    return rejectEdit('unsupported-field', 'This static field is not editable.');
  }

  let current = input.source;
  for (let i = 0; i < input.operations.length; i += 1) {
    const analysis = i === 0 ? first : analyzeHtml(input.path, current, input.selectionMode);
    if ('status' in analysis) return analysis;
    const located = analysis.targets[index];
    if (!located || located.target.tagName !== initial.target.tagName) {
      return rejectEdit('stale-source', 'The selected definition moved while applying the batch.');
    }
    let operation = input.operations[i] as SourceEditOperation;
    if (operation.kind === 'set-text') {
      const textSpan = located.textSpans[textOrdinals[i] ?? -1];
      if (!textSpan) return rejectEdit('unsupported-field', 'This static field is not editable.');
      operation =
        textSpan.textId === undefined
          ? { kind: 'set-text', value: operation.value }
          : { kind: 'set-text', value: operation.value, textId: textSpan.textId };
    }
    const step = planHtmlSourceEdit({
      path: input.path,
      source: current,
      expectedSourceHash: sha256Hex(current),
      targetId: located.target.id,
      operation,
      scope: input.scope,
      selectionMode: input.selectionMode,
    });
    if (step.status !== 'applied') return step;
    current = step.content;
  }

  return {
    schemaVersion: 1,
    status: 'applied',
    path: input.path,
    content: current,
    sourceHash: sha256Hex(current),
    patch: minimalPatch(input.source, current),
    scope: 'source-definition',
  };
}
