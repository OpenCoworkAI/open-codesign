import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface EnsureUserTemplatesResult {
  action: 'seeded' | 'merged' | 'skipped' | 'missing-source';
  source: string;
  dest: string;
  copiedFiles?: number;
  updatedFiles?: number;
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
  const updatedFiles = await repairBundledManifests(sourceDir, dest);
  return copiedFiles + updatedFiles > 0
    ? { action: 'merged', source: sourceDir, dest, copiedFiles, updatedFiles }
    : { action: 'skipped', source: sourceDir, dest, copiedFiles: 0, updatedFiles: 0 };
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

async function repairBundledManifests(sourceDir: string, destDir: string): Promise<number> {
  return repairScaffoldManifest(
    path.join(sourceDir, 'scaffolds', 'manifest.json'),
    path.join(destDir, 'scaffolds', 'manifest.json'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function patchStringField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  field: string,
): boolean {
  if (isNonEmptyString(target[field]) || !isNonEmptyString(source[field])) return false;
  target[field] = source[field];
  return true;
}

async function repairScaffoldManifest(sourcePath: string, destPath: string): Promise<number> {
  if (!existsSync(sourcePath) || !existsSync(destPath)) return 0;

  let sourceManifest: unknown;
  let destManifest: unknown;
  try {
    sourceManifest = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
    destManifest = JSON.parse(await readFile(destPath, 'utf8')) as unknown;
  } catch {
    return 0;
  }
  if (!isRecord(sourceManifest) || !isRecord(destManifest)) return 0;
  const sourceScaffolds = sourceManifest['scaffolds'];
  if (!isRecord(sourceScaffolds)) return 0;

  let changed = false;
  if (destManifest['schemaVersion'] !== sourceManifest['schemaVersion']) {
    destManifest['schemaVersion'] = sourceManifest['schemaVersion'];
    changed = true;
  }
  if (!isRecord(destManifest['scaffolds'])) {
    destManifest['scaffolds'] = {};
    changed = true;
  }
  const destScaffolds = destManifest['scaffolds'];
  if (!isRecord(destScaffolds)) return 0;

  for (const [kind, rawSourceEntry] of Object.entries(sourceScaffolds)) {
    if (!isRecord(rawSourceEntry)) continue;
    const rawDestEntry = destScaffolds[kind];
    if (!isRecord(rawDestEntry)) {
      destScaffolds[kind] = cloneJsonRecord(rawSourceEntry);
      changed = true;
      continue;
    }
    for (const field of ['description', 'path', 'license', 'source', 'category']) {
      changed = patchStringField(rawDestEntry, rawSourceEntry, field) || changed;
    }
    if (!Array.isArray(rawDestEntry['aliases']) && Array.isArray(rawSourceEntry['aliases'])) {
      rawDestEntry['aliases'] = [...rawSourceEntry['aliases']];
      changed = true;
    }
    if (
      typeof rawDestEntry['sizeBytes'] !== 'number' &&
      typeof rawSourceEntry['sizeBytes'] === 'number'
    ) {
      rawDestEntry['sizeBytes'] = rawSourceEntry['sizeBytes'];
      changed = true;
    }
  }

  if (!changed) return 0;
  await writeFile(destPath, `${JSON.stringify(destManifest, null, 2)}\n`, 'utf8');
  return 1;
}
