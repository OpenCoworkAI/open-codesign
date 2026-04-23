import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveNativeBindingPath } from './snapshots-db';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeReleaseDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesign-sqlite-binding-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveNativeBindingPath', () => {
  it('prefers the arch-specific Electron binding when present', () => {
    const releaseDir = makeReleaseDir();
    const electronBinding = path.join(releaseDir, 'better_sqlite3.node-electron-x64.node');
    const legacyBinding = path.join(releaseDir, 'better_sqlite3.node-electron.node');
    const defaultBinding = path.join(releaseDir, 'better_sqlite3.node');
    fs.writeFileSync(electronBinding, '');
    fs.writeFileSync(legacyBinding, '');
    fs.writeFileSync(defaultBinding, '');

    expect(resolveNativeBindingPath(releaseDir, true, 'x64')).toBe(electronBinding);
  });

  it('falls back to the legacy Electron binding when the arch-specific one is missing', () => {
    const releaseDir = makeReleaseDir();
    const legacyBinding = path.join(releaseDir, 'better_sqlite3.node-electron.node');
    const defaultBinding = path.join(releaseDir, 'better_sqlite3.node');
    fs.writeFileSync(legacyBinding, '');
    fs.writeFileSync(defaultBinding, '');

    expect(resolveNativeBindingPath(releaseDir, true, 'arm64')).toBe(legacyBinding);
  });

  it('falls back to the default binding when the runtime-specific one is missing', () => {
    const releaseDir = makeReleaseDir();
    const defaultBinding = path.join(releaseDir, 'better_sqlite3.node');
    fs.writeFileSync(defaultBinding, '');

    expect(resolveNativeBindingPath(releaseDir, true, 'arm64')).toBe(defaultBinding);
  });

  it('keeps the Node-specific path when no Node binding was staged', () => {
    const releaseDir = makeReleaseDir();
    const defaultBinding = path.join(releaseDir, 'better_sqlite3.node');
    const nodeBinding = path.join(releaseDir, 'better_sqlite3.node-node.node');
    fs.writeFileSync(defaultBinding, '');

    expect(resolveNativeBindingPath(releaseDir, false)).toBe(nodeBinding);
  });
});
