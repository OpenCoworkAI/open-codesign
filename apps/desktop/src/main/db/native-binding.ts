/**
 * Native binding resolution for better-sqlite3.
 *
 * scripts/install-sqlite-bindings.cjs stages the host Node prebuild plus
 * per-arch Electron prebuilds side by side so one `pnpm install` covers both
 * runtimes without an electron-rebuild step.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);

export type Database = BetterSqlite3.Database;

export function resolveNativeBindingPath(
  releaseDir: string,
  isElectron = typeof process.versions.electron === 'string',
  arch = process.arch,
): string {
  if (isElectron) {
    const archSpecific = path.join(releaseDir, `better_sqlite3.node-electron-${arch}.node`);
    if (fs.existsSync(archSpecific)) return archSpecific;
    const legacyElectron = path.join(releaseDir, 'better_sqlite3.node-electron.node');
    if (fs.existsSync(legacyElectron)) return legacyElectron;
    throw new Error(
      `better-sqlite3 Electron native binding missing for ${arch}: expected ${archSpecific}`,
    );
  }
  const runtimeSpecific = path.join(releaseDir, 'better_sqlite3.node-node.node');
  if (fs.existsSync(runtimeSpecific)) return runtimeSpecific;
  throw new Error(`better-sqlite3 Node native binding missing: expected ${runtimeSpecific}`);
}

export function resolveNativeBinding(): string {
  const pkgJson = require.resolve('better-sqlite3/package.json');
  return resolveNativeBindingPath(path.join(path.dirname(pkgJson), 'build', 'Release'));
}

export function openDatabase(filename: string, options?: BetterSqlite3.Options): Database {
  const Database = require('better-sqlite3') as typeof BetterSqlite3;
  return new Database(filename, { ...options, nativeBinding: resolveNativeBinding() });
}
