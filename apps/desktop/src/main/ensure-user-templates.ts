import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EnsureUserTemplatesResult {
  action: 'seeded' | 'skipped' | 'missing-source';
  source: string;
  dest: string;
}

/**
 * Resolve the bundled template source directory.
 *
 * In production, electron-builder extraResources puts them under
 * `process.resourcesPath/templates`. In dev, electron-vite is running the
 * bundled main out of `apps/desktop/out/main`, so we walk upwards until we
 * find a `resources/templates` sibling of a `package.json`.
 */
export function resolveBundledTemplatesDir(
  resourcesPath: string | undefined,
  startFile: string = fileURLToPath(import.meta.url),
): string | null {
  const prodCandidate = resourcesPath !== undefined ? path.join(resourcesPath, 'templates') : null;
  if (prodCandidate && existsSync(prodCandidate)) return prodCandidate;

  let dir = path.dirname(startFile);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'resources', 'templates');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Copy the bundled templates into `<userData>/templates` on first boot so the
 * user owns the tree afterwards. No-op if the destination already exists —
 * this means edits survive upgrades and deleting the folder re-seeds on next
 * launch.
 */
export async function ensureUserTemplates(
  userDataDir: string,
  sourceDir: string | null,
): Promise<EnsureUserTemplatesResult> {
  const dest = path.join(userDataDir, 'templates');
  if (existsSync(dest)) return { action: 'skipped', source: sourceDir ?? '', dest };
  if (sourceDir === null || !existsSync(sourceDir)) {
    return { action: 'missing-source', source: sourceDir ?? '', dest };
  }
  await cp(sourceDir, dest, { recursive: true });
  return { action: 'seeded', source: sourceDir, dest };
}
