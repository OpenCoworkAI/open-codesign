import type { DesignToken } from '@open-codesign/shared';

// W3C Design Tokens Community Group spec (2025.10 stable) defines leaf tokens
// as JSON objects containing a `$value` key and an optional `$type` key.
// Groups are plain objects without `$value`.

type TokenType = DesignToken['type'];

// Map W3C DTCG $type values to our internal token types.
const DTCG_TYPE_MAP: Partial<Record<string, TokenType>> = {
  color: 'color',
  fontFamily: 'fontFamily',
  fontSize: 'fontSize',
  dimension: 'spacing',
  shadow: 'shadow',
  number: 'spacing',
};

function resolveTypeFromPath(path: string): TokenType | null {
  const p = path.toLowerCase();
  if (/color|palette|fill|bg|background|foreground/.test(p)) return 'color';
  if (/font-family|fontfamily|typeface/.test(p)) return 'fontFamily';
  if (/font-size|fontsize|text-size/.test(p)) return 'fontSize';
  if (/spacing|space|gap|padding|margin/.test(p)) return 'spacing';
  if (/radius|rounded/.test(p)) return 'radius';
  if (/shadow|elevation/.test(p)) return 'shadow';
  if (/line-height|lineheight|leading/.test(p)) return 'lineHeight';
  return null;
}

function resolveType(dtcgType: string | undefined, path: string): TokenType | null {
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
): void {
  const rawValue = record['$value'];
  const $type = typeof record['$type'] === 'string' ? record['$type'] : inherited$type;

  const value = serializeValue(rawValue);
  const name = pathSegments.join('.');
  const tokenType = resolveType($type, name);
  if (!tokenType) return;

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
): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;

  const record = node as Record<string, unknown>;

  if ('$value' in record) {
    pushLeafToken(record, pathSegments, inherited$type, into);
    return;
  }

  // Group node — descend, inheriting $type if declared on the group.
  const groupType = typeof record['$type'] === 'string' ? record['$type'] : inherited$type;

  for (const key of Object.keys(record)) {
    if (key.startsWith('$')) continue;
    walk(record[key], [...pathSegments, key], groupType, into);
  }
}

export function importDtcgJson(json: unknown): DesignToken[] {
  const tokens: DesignToken[] = [];
  walk(json, [], undefined, tokens);
  return tokens;
}
