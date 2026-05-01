import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EnsureUserTemplatesResult {
  action: 'seeded' | 'merged' | 'skipped' | 'missing-source';
  source: string;
  dest: string;
  copiedFiles?: number;
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
 * Copy bundled templates into `<userData>/templates` so the user owns the tree
 * afterwards. Existing files are never overwritten; upgrades only add new
 * bundled files that the user does not already have.
 */
export async function ensureUserTemplates(
  userDataDir: string,
  sourceDir: string | null,
): Promise<EnsureUserTemplatesResult> {
  const dest = path.join(userDataDir, 'templates');
  if (sourceDir === null || !existsSync(sourceDir)) {
    return { action: 'missing-source', source: sourceDir ?? '', dest };
  }
  if (!existsSync(dest)) {
    await cp(sourceDir, dest, { recursive: true });
    return { action: 'seeded', source: sourceDir, dest };
  }

  const copiedFiles = await copyMissingFiles(sourceDir, dest);
  return copiedFiles > 0
    ? { action: 'merged', source: sourceDir, dest, copiedFiles }
    : { action: 'skipped', source: sourceDir, dest, copiedFiles: 0 };
}

async function copyMissingFiles(sourceDir: string, destDir: string): Promise<number> {
  await mkdir(destDir, { recursive: true });
  let copied = 0;
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copied += await copyMissingFiles(sourcePath, destPath);
      continue;
    }
    if (!entry.isFile() || existsSync(destPath)) continue;
    await mkdir(path.dirname(destPath), { recursive: true });
    await cp(sourcePath, destPath, { recursive: false });
    copied++;
  }
  return copied;
}
