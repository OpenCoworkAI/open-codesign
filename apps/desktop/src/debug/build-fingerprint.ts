import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Include shared source and build configuration; test-only edits do not invalidate the UI build. */
export async function uiSourceFingerprint(desktopRoot: string): Promise<string> {
  const root = resolve(desktopRoot, '../..');
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '__fixtures__' ||
        entry.name.includes('.test.')
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(join(desktopRoot, 'src'));
  for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, 'packages', entry.name);
    await visit(join(directory, 'src')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    files.push(join(directory, 'package.json'));
  }
  files.push(
    join(root, 'pnpm-lock.yaml'),
    join(root, 'package.json'),
    join(desktopRoot, 'package.json'),
    join(desktopRoot, 'electron.vite.config.ts'),
    join(desktopRoot, 'postcss.config.cjs'),
  );
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(relative(root, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
