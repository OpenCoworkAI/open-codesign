/** Shared literal-value boundary for deterministic JSX and HTML style edits. */
export function validSourceEditStyle(property: string, value: string): boolean {
  if (value !== value.trim() || !value || /[\\;{}<>]|(?:url|expression|var)\s*\(/i.test(value))
    return false;
  if (property === 'color' || property === 'backgroundColor') {
    return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]+\))$/i.test(
      value,
    );
  }
  if (property === 'maxWidth' && value === 'none') return true;
  const parts = value.split(/ +/);
  const max =
    property === 'padding' || property === 'borderRadius' ? 4 : property === 'gap' ? 2 : 1;
  return (
    parts.length <= max &&
    parts.every(
      (part) =>
        /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|ch|ex)?$/.test(part) &&
        Number.isFinite(Number.parseFloat(part)),
    )
  );
}
