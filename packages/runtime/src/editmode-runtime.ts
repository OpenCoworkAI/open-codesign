const EDITMODE_BEGIN_RE = /\/\*\s*EDITMODE-BEGIN\s*\*\//g;
const EDITMODE_END_RE = /\/\*\s*EDITMODE-END\s*\*\//g;

export function bindEditmodeTokensToRuntime(source: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    EDITMODE_BEGIN_RE.lastIndex = cursor;
    const begin = EDITMODE_BEGIN_RE.exec(source);
    if (!begin) break;
    EDITMODE_END_RE.lastIndex = EDITMODE_BEGIN_RE.lastIndex;
    const end = EDITMODE_END_RE.exec(source);
    // An unmatched first BEGIN means no later BEGIN can have a matching END.
    // Do not rescan its suffix for every nested BEGIN (quadratic on malformed input).
    if (!end) break;
    chunks.push(source.slice(cursor, begin.index), 'window.__codesign_tweaks__.tokens');
    cursor = EDITMODE_END_RE.lastIndex;
  }
  if (chunks.length === 0) return source;
  chunks.push(source.slice(cursor));
  return chunks.join('');
}
