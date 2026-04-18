import type { DesignToken } from '@open-codesign/shared';

// W3C Design Tokens Community Group spec (2025.10 stable) defines leaf tokens
// as JSON objects containing a `$value` key and an optional `$type` key.
// Groups are plain objects without `$value`.

type TokenType = DesignToken['type'];

// Map W3C DTCG $type values that have an unambiguous internal counterpart.
// `dimension` and `number` are intentionally absent: they can mean spacing,
// font-size, line-height, radius, border-width, etc. — the path is the only
// reliable hint, so we infer instead of forcing a single bucket.
const DTCG_TYPE_MAP: Partial<Record<string, TokenType>> = {
  color: 'color',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  shadow: 'shadow',
  lineHeight: 'lineHeight',
};

function resolveTypeFromPath(path: string): TokenType | null {
  const p = path.toLowerCase();
  if (/color|palette|fill|bg|background|foreground/.test(p)) return 'color';
  if (/font-family|fontfamily|typeface/.test(p)) return 'fontFamily';
  if (/font-size|fontsize|text-size/.test(p)) return 'fontSize';
  if (/line-height|lineheight|leading/.test(p)) return 'lineHeight';
  if (/radius|rounded/.test(p)) return 'radius';
  if (/shadow|elevation/.test(p)) return 'shadow';
  if (/spacing|space|gap|padding|margin/.test(p)) return 'spacing';
  return null;
}

function resolveType(dtcgType: string | undefined, path: string): TokenType | null {
  // Ambiguous DTCG types — name/path is authoritative, never silently coerce.
  if (dtcgType === 'dimension' || dtcgType === 'number') {
    return resolveTypeFromPath(path);
  }
  if (dtcgType) {
    const mapped = DTCG_TYPE_MAP[dtcgType];
    if (mapped) return mapped;
  }
  return resolveTypeFromPath(path);
}

function serializeValue(rawValue: unknown): string {
  if (typeof rawValue === 'string') return rawValue;
  if (typeof rawValue === 'number') return String(rawValue);
  return JSON.stringify(rawValue);
}

function pushLeafToken(
  record: Record<string, unknown>,
  pathSegments: string[],
  inherited$type: string | undefined,
  into: DesignToken[],
  unresolved: string[],
): void {
  const rawValue = record['$value'];
  const $type = typeof record['$type'] === 'string' ? record['$type'] : inherited$type;

  const value = serializeValue(rawValue);
  const name = pathSegments.join('.');
  const resolved = resolveType($type, name);
  // Preserve unrecognized tokens under `unknown` rather than silently dropping
  // them — losing user-authored brand tokens is worse than carrying a token
  // the renderer chooses to ignore. Caller is warned with the full name list.
  const tokenType: TokenType = resolved ?? 'unknown';
  if (resolved === null) {
    unresolved.push(name);
  }

  const group = pathSegments.length > 1 ? pathSegments.slice(0, -1).join('.') : undefined;

  into.push({
    schemaVersion: 1,
    type: tokenType,
    name,
    value,
    origin: 'dtcg-json',
    ...(group !== undefined ? { group } : {}),
  });
}

// Recursively walk a DTCG JSON tree. Leaf token nodes carry `$value`;
// group nodes hold other nodes.
function walk(
  node: unknown,
  pathSegments: string[],
  inherited$type: string | undefined,
  into: DesignToken[],
  unresolved: string[],
): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;

  const record = node as Record<string, unknown>;

  if ('$value' in record) {
    pushLeafToken(record, pathSegments, inherited$type, into, unresolved);
    return;
  }

  // Group node — descend, inheriting $type if declared on the group.
  const groupType = typeof record['$type'] === 'string' ? record['$type'] : inherited$type;

  for (const key of Object.keys(record)) {
    if (key.startsWith('$')) continue;
    walk(record[key], [...pathSegments, key], groupType, into, unresolved);
  }
}

export function importDtcgJson(json: unknown): DesignToken[] {
  const tokens: DesignToken[] = [];
  const unresolved: string[] = [];
  walk(json, [], undefined, tokens, unresolved);
  if (unresolved.length > 0) {
    console.warn(
      `[dtcgImporter] ${unresolved.length} token(s) imported as type "unknown" (could not infer DTCG type from $type or path): ${unresolved.join(', ')}`,
    );
  }
  return tokens;
}
