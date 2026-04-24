/**
 * Splits the craft-directives section into named subsections so the
 * progressive-disclosure composer can pick only the subsections relevant to
 * the user's prompt.
 *
 * The intro paragraph (everything before the first `## `) is preserved
 * under the `__intro__` key so it is always emitted alongside any matched
 * subsection.
 */
import { CRAFT_DIRECTIVES } from './sections/loader.js';

function buildCraftSubsectionMap(): Map<string, string> {
  const map = new Map<string, string>();
  const parts = CRAFT_DIRECTIVES.split(/\n(?=## )/);
  const intro = parts[0];
  if (intro !== undefined) {
    map.set('__intro__', intro);
  }
  for (const part of parts.slice(1)) {
    const headingMatch = part.match(/^## (.+?)\n/);
    const heading = headingMatch?.[1];
    if (heading) {
      map.set(heading.trim(), part);
    }
  }
  return map;
}

const CRAFT_SUBSECTIONS = buildCraftSubsectionMap();

export function craftSubsection(name: string): string | undefined {
  return CRAFT_SUBSECTIONS.get(name);
}

export function buildCraftBlock(subsectionNames: string[]): string | undefined {
  if (subsectionNames.length === 0) return undefined;
  const parts: string[] = [];
  const intro = craftSubsection('__intro__');
  if (intro) parts.push(intro);
  for (const name of subsectionNames) {
    const sub = craftSubsection(name);
    if (sub) parts.push(sub);
  }
  return parts.length > 1 ? parts.join('\n\n') : undefined;
}
