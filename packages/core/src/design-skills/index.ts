import { lstat, readdir, readFile } from 'node:fs/promises';
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

async function assertTemplatePathIsNotSymlink(filePath: string): Promise<void> {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink()) {
    throw new Error(`template path must not be a symbolic link: ${filePath}`);
  }
}

/**
 * Read every known design-skill file from the given directory. A missing
 * directory is an explicit empty state; a missing/unreadable declared file is a
 * template installation error. Returns `[name, contents]` pairs in the
 * canonical order defined by `DESIGN_SKILL_FILES`.
 */
export async function loadDesignSkills(dir: string): Promise<Array<[string, string]>> {
  try {
    await readdir(dir);
    await assertTemplatePathIsNotSymlink(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return Promise.all(
    DESIGN_SKILL_FILES.map(async (name): Promise<[string, string]> => {
      const filePath = path.join(dir, name);
      await assertTemplatePathIsNotSymlink(filePath);
      const contents = await readFile(filePath, 'utf8');
      return [name, contents];
    }),
  );
}
