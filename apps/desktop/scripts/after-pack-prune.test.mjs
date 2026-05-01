import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import afterPackPrune from './after-pack-prune.cjs';

async function touch(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'x');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

describe('after-pack-prune', () => {
  it('keeps only target native binaries in the mac app unpacked resources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-after-pack-prune-'));
    try {
      const resourcesDir = path.join(root, 'Open CoDesign.app', 'Contents', 'Resources');
      const nodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'darwin_arm64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'darwin_x64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'linux_x64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'src', 'native.cc'));
      await touch(path.join(nodeModules, 'koffi', 'vendor', 'node-addon-api', 'napi.h'));

      const releaseDir = path.join(nodeModules, 'better-sqlite3', 'build', 'Release');
      await touch(path.join(releaseDir, 'better_sqlite3.node-electron-arm64.node'));
      await touch(path.join(releaseDir, 'better_sqlite3.node-electron-x64.node'));
      await touch(path.join(releaseDir, 'better_sqlite3.node-node.node'));
      await touch(path.join(releaseDir, 'install-sqlite-bindings.lock.json'));
      await touch(path.join(nodeModules, 'better-sqlite3', 'deps', 'sqlite3', 'sqlite3.c'));
      await touch(path.join(nodeModules, 'better-sqlite3', 'src', 'addon.cpp'));

      await touch(path.join(nodeModules, 'jszip', 'docs', 'index.md'));
      await touch(path.join(nodeModules, 'jszip', 'lib', 'index.js'));

      await afterPackPrune({
        appOutDir: root,
        electronPlatformName: 'darwin',
        arch: 3,
        packager: { appInfo: { productFilename: 'Open CoDesign' } },
      });

      await expect(readdir(path.join(nodeModules, 'koffi', 'build', 'koffi'))).resolves.toEqual([
        'darwin_arm64',
      ]);
      await expect(readdir(releaseDir)).resolves.toEqual([
        'better_sqlite3.node-electron-arm64.node',
      ]);
      await expect(exists(path.join(nodeModules, 'koffi', 'src'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'koffi', 'vendor'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'better-sqlite3', 'deps'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'better-sqlite3', 'src'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'jszip', 'docs'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'jszip', 'lib', 'index.js'))).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails packaging when the target better-sqlite3 Electron binary is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-after-pack-prune-missing-'));
    try {
      const resourcesDir = path.join(root, 'Open CoDesign.app', 'Contents', 'Resources');
      const nodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');
      const releaseDir = path.join(nodeModules, 'better-sqlite3', 'build', 'Release');
      await touch(path.join(releaseDir, 'better_sqlite3.node-electron-x64.node'));

      await expect(
        afterPackPrune({
          appOutDir: root,
          electronPlatformName: 'darwin',
          arch: 3,
          packager: { appInfo: { productFilename: 'Open CoDesign' } },
        }),
      ).rejects.toThrow(/better-sqlite3 Electron binary missing/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
