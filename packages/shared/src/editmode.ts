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

const EDITMODE_RE = /\/\*\s*EDITMODE-BEGIN\s*\*\/([\s\S]*?)\/\*\s*EDITMODE-END\s*\*\//;
const TWEAK_SCHEMA_RE = /\/\*\s*TWEAK-SCHEMA-BEGIN\s*\*\/([\s\S]*?)\/\*\s*TWEAK-SCHEMA-END\s*\*\//;

export interface EditmodeBlock {
  tokens: Record<string, unknown>;
  /** Raw inner span (between the markers) — useful for diagnostics. */
  raw: string;
  /** `marked` = canonical EDITMODE markers. */
  source: 'marked';
}

export function parseEditmodeBlock(source: string): EditmodeBlock | null {
  const match = EDITMODE_RE.exec(source);
  if (!match) return null;
  const raw = (match[1] ?? '').trim();
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
  if (EDITMODE_RE.test(source)) {
    return source.replace(EDITMODE_RE, `/*EDITMODE-BEGIN*/${json}/*EDITMODE-END*/`);
  }
  return source;
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
  const match = TWEAK_SCHEMA_RE.exec(source);
  if (!match) return null;
  const raw = (match[1] ?? '').trim();
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
  if (TWEAK_SCHEMA_RE.test(source)) {
    return source.replace(TWEAK_SCHEMA_RE, `/*TWEAK-SCHEMA-BEGIN*/${json}/*TWEAK-SCHEMA-END*/`);
  }
  const marked = EDITMODE_RE.exec(source);
  if (marked) {
    // Find the end of the statement containing the EDITMODE block (next ';').
    const editEnd = marked.index + marked[0].length;
    const semi = source.indexOf(';', editEnd);
    const insertAt = semi >= 0 ? semi + 1 : editEnd;
    const block = `\nconst TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/${json}/*TWEAK-SCHEMA-END*/;`;
    return `${source.slice(0, insertAt)}${block}${source.slice(insertAt)}`;
  }
  return source;
}
