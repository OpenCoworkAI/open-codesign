import { lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vueLink = join(websiteRoot, 'node_modules', 'vue');

try {
  const entry = await lstat(vueLink);
  if (entry.isSymbolicLink()) {
    await rm(vueLink, { force: true });
  }
} catch (err) {
  if (err && typeof err === 'object' && err.code === 'ENOENT') {
    process.exit(0);
  }
  throw err;
}
