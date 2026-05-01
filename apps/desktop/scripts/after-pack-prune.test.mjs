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
  it('keeps only target koffi native binaries in the mac app unpacked resources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-after-pack-prune-'));
    try {
      const resourcesDir = path.join(root, 'Open CoDesign.app', 'Contents', 'Resources');
      const nodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'darwin_arm64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'darwin_x64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'build', 'koffi', 'linux_x64', 'koffi.node'));
      await touch(path.join(nodeModules, 'koffi', 'src', 'native.cc'));
      await touch(path.join(nodeModules, 'koffi', 'vendor', 'node-addon-api', 'napi.h'));

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
      await expect(exists(path.join(nodeModules, 'koffi', 'src'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'koffi', 'vendor'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'jszip', 'docs'))).resolves.toBe(false);
      await expect(exists(path.join(nodeModules, 'jszip', 'lib', 'index.js'))).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not require a native database module in packaged resources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-after-pack-prune-no-native-db-'));
    try {
      const resourcesDir = path.join(root, 'Open CoDesign.app', 'Contents', 'Resources');
      const nodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');
      await touch(path.join(nodeModules, 'jszip', 'lib', 'index.js'));

      await expect(
        afterPackPrune({
          appOutDir: root,
          electronPlatformName: 'darwin',
          arch: 3,
          packager: { appInfo: { productFilename: 'Open CoDesign' } },
        }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
