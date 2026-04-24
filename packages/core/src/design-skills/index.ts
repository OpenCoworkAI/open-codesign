import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Design-skill starter snippets — JSX modules that the agent can `view` from
 * the virtual filesystem and adapt to the user's brief.
 *
 * The files live in `<userData>/templates/design-skills/` (seeded from the
 * app bundle on first boot, user-editable afterwards). This module is a thin
 * loader: pass the directory, get back the filename → contents pairs.
 *
 * Each .jsx file is a complete `<script type="text/babel">` payload with a
 * `// when_to_use:` hint comment at the top so the agent can decide which
 * skill (if any) applies before opening the file.
 */

export const DESIGN_SKILL_FILES = [
  'slide-deck.jsx',
  'dashboard.jsx',
  'landing-page.jsx',
  'chart-svg.jsx',
  'glassmorphism.jsx',
  'editorial-typography.jsx',
  'heroes.jsx',
  'pricing.jsx',
  'footers.jsx',
  'chat-ui.jsx',
  'data-table.jsx',
  'calendar.jsx',
] as const;

export type DesignSkillName = (typeof DESIGN_SKILL_FILES)[number];

/**
 * Read every known design-skill file from the given directory, skipping
 * entries the user has deleted. Returns `[name, contents]` pairs in the
 * canonical order defined by `DESIGN_SKILL_FILES`.
 */
export async function loadDesignSkills(dir: string): Promise<Array<[string, string]>> {
  const results = await Promise.all(
    DESIGN_SKILL_FILES.map(async (name): Promise<[string, string] | null> => {
      try {
        const contents = await readFile(path.join(dir, name), 'utf8');
        return [name, contents];
      } catch {
        return null;
      }
    }),
  );
  return results.filter((entry): entry is [string, string] => entry !== null);
}
