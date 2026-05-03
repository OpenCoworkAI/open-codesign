import { CodesignError } from './codesign-error';
import { ERROR_CODES } from './error-codes';

/**
 * EDITMODE marker block — extract & rewrite the agent-declared `TWEAK_DEFAULTS`
 * JSON object embedded inside an artifact source.
 *
 * Canonical format (matches agent.ts AGENTIC_TOOL_GUIDANCE Output format):
 *
 *   const TWEAK_DEFAULTS = /\* EDITMODE-BEGIN *\/{ "key": "value" }/\* EDITMODE-END *\/;
 *
 * Whitespace between the markers is preserved on round-trip; the parser
 * treats the inner span as a JSON object literal. Missing markers mean "no
 * tweak block"; present-but-malformed markers are a protocol error.
 */

interface MarkerBlock {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  inner: string;
}

function compactMarkerName(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch.trim().length !== 0) out += ch;
  }
  return out;
}

function findMarker(
  source: string,
  marker: string,
  from = 0,
): { start: number; end: number } | null {
  let start = source.indexOf('/*', from);
  while (start >= 0) {
    const end = source.indexOf('*/', start + 2);
    if (end < 0) return null;
    if (compactMarkerName(source.slice(start + 2, end)) === marker) {
      return { start, end: end + 2 };
    }
    start = source.indexOf('/*', end + 2);
  }
  return null;
}

function findMarkerBlock(source: string, kind: 'EDITMODE' | 'TWEAK-SCHEMA'): MarkerBlock | null {
  const begin = findMarker(source, `${kind}-BEGIN`);
  if (begin === null) return null;
  const end = findMarker(source, `${kind}-END`, begin.end);
  if (end === null) return null;
  return {
    start: begin.start,
    end: end.end,
    innerStart: begin.end,
    innerEnd: end.start,
    inner: source.slice(begin.end, end.start),
  };
}

function replaceMarkerBlock(
  source: string,
  kind: 'EDITMODE' | 'TWEAK-SCHEMA',
  replacement: string,
): string {
  const block = findMarkerBlock(source, kind);
  if (block === null) return source;
  return `${source.slice(0, block.start)}/*${kind}-BEGIN*/${replacement}/*${kind}-END*/${source.slice(block.end)}`;
}

export interface EditmodeBlock {
  tokens: Record<string, unknown>;
  /** Raw inner span (between the markers) — useful for diagnostics. */
  raw: string;
  /** `marked` = canonical EDITMODE markers. */
  source: 'marked';
}

export function parseEditmodeBlock(source: string): EditmodeBlock | null {
  const block = findMarkerBlock(source, 'EDITMODE');
  if (block === null) return null;
  const raw = block.inner.trim();
  if (raw.length === 0) return { tokens: {}, raw, source: 'marked' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new CodesignError(
      'EDITMODE block contains invalid JSON',
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
      {
        cause,
      },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CodesignError(
      'EDITMODE block must contain a JSON object',
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
  return { tokens: parsed as Record<string, unknown>, raw, source: 'marked' };
}

export function replaceEditmodeBlock(source: string, newTokens: Record<string, unknown>): string {
  const json = JSON.stringify(newTokens, null, 2);
  return replaceMarkerBlock(source, 'EDITMODE', json);
}

/**
 * Kept for older runtime call sites. v0.2 no longer repairs missing EDITMODE
 * markers; the agent must emit the canonical protocol itself.
 */
export function ensureEditmodeMarkers(source: string): string {
  return source;
}

// ---------------------------------------------------------------------------
// TWEAK_SCHEMA — agent-declared UI hints for each token in TWEAK_DEFAULTS.
//
// The agent emits a parallel marker block alongside TWEAK_DEFAULTS:
//
//   const TWEAK_SCHEMA = /\* TWEAK-SCHEMA-BEGIN *\/{
//     accentColor: { kind: "color" },
//     radius: { kind: "number", min: 0, max: 32, step: 2, unit: "px" }
//   }/\* TWEAK-SCHEMA-END *\/;
//
// TweakPanel consumes the schema to pick precise controls (real range slider
// for numbers, segmented picker for enums, etc). Schema is advisory: entries
// may be omitted, but a present schema marker must be valid JSON with valid
// entry shapes.
// ---------------------------------------------------------------------------

export type TokenSchemaEntry =
  | { kind: 'color' }
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'enum'; options: string[] }
  | { kind: 'boolean' }
  | { kind: 'string'; placeholder?: string };

export type TweakSchema = Record<string, TokenSchemaEntry>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalNumber(value: Record<string, unknown>, key: string): number | null | undefined {
  if (!hasOwn(value, key)) return undefined;
  const raw = value[key];
  return typeof raw === 'number' ? raw : null;
}

function isStringArray(value: unknown[]): value is string[] {
  return value.every((option) => typeof option === 'string');
}

function validateEntry(value: unknown): TokenSchemaEntry | null {
  if (!isPlainObject(value)) return null;
  const kind = value['kind'];
  if (kind === 'color' || kind === 'boolean') {
    return { kind };
  }
  if (kind === 'number') {
    const min = optionalNumber(value, 'min');
    const max = optionalNumber(value, 'max');
    const step = optionalNumber(value, 'step');
    if (min === null || max === null || step === null) return null;
    if (hasOwn(value, 'unit') && typeof value['unit'] !== 'string') return null;
    const out: TokenSchemaEntry = { kind: 'number' };
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    if (step !== undefined) out.step = step;
    if (typeof value['unit'] === 'string') out.unit = value['unit'];
    return out;
  }
  if (kind === 'enum') {
    const options = value['options'];
    if (!Array.isArray(options)) return null;
    if (options.length === 0 || !isStringArray(options)) {
      return null;
    }
    return { kind: 'enum', options };
  }
  if (kind === 'string') {
    if (hasOwn(value, 'placeholder') && typeof value['placeholder'] !== 'string') return null;
    const out: TokenSchemaEntry = { kind: 'string' };
    if (typeof value['placeholder'] === 'string') out.placeholder = value['placeholder'];
    return out;
  }
  return null;
}

export function parseTweakSchema(source: string): TweakSchema | null {
  const block = findMarkerBlock(source, 'TWEAK-SCHEMA');
  if (block === null) return null;
  const raw = block.inner.trim();
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CodesignError(
      'TWEAK_SCHEMA block contains invalid JSON',
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
      { cause },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new CodesignError(
      'TWEAK_SCHEMA block must contain a JSON object',
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
  const out: TweakSchema = {};
  for (const [key, entry] of Object.entries(parsed)) {
    const validated = validateEntry(entry);
    if (!validated) {
      throw new CodesignError(
        `TWEAK_SCHEMA entry "${key}" is invalid`,
        ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
      );
    }
    out[key] = validated;
  }
  return out;
}

/**
 * Replace (or insert) the TWEAK_SCHEMA block in `source`.
 *
 *   - If `/\* TWEAK-SCHEMA-BEGIN *\/...END` already exists → swap the inner JSON.
 *   - Else if the source has a marked TWEAK_DEFAULTS line → insert
 *     a new `const TWEAK_SCHEMA = /\* ... *\/;` line right after it.
 *   - Else → return source unchanged. Caller is responsible for ensuring the
 *     artifact has a TWEAK_DEFAULTS block first.
 */
export function replaceTweakSchema(source: string, schema: TweakSchema): string {
  const json = JSON.stringify(schema, null, 2);
  if (findMarkerBlock(source, 'TWEAK-SCHEMA')) {
    return replaceMarkerBlock(source, 'TWEAK-SCHEMA', json);
  }
  const marked = findMarkerBlock(source, 'EDITMODE');
  if (marked) {
    // Find the end of the statement containing the EDITMODE block (next ';').
    const editEnd = marked.end;
    const semi = source.indexOf(';', editEnd);
    const insertAt = semi >= 0 ? semi + 1 : editEnd;
    const block = `\nconst TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/${json}/*TWEAK-SCHEMA-END*/;`;
    return `${source.slice(0, insertAt)}${block}${source.slice(insertAt)}`;
  }
  return source;
}
