import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('uses the installed builder download API with a pinned checksum', async () => {
  const builderRequire = createRequire(
    createRequire(import.meta.url).resolve('electron-builder/package.json'),
  );
  expect(typeof builderRequire('app-builder-lib/out/binDownload').getBinFromUrl).toBe('function');
  const calls = [];
  const source = readFileSync(new URL('./electron-builder-macos.cjs', import.meta.url), 'utf8');
  const fakeRequire = (id) => {
    if (id === 'node:module')
      return {
        createRequire: () => () => ({
          getBinFromUrl: async (...args) => {
            calls.push(args);
            return '/vendor';
          },
        }),
      };
    return createRequire(import.meta.url)(id);
  };
  fakeRequire.resolve = () => '/builder/package.json';
  const context = vm.createContext({ require: fakeRequire, process: { arch: 'arm64' } });
  vm.runInContext(source.slice(0, source.indexOf('main().catch')), context);
  expect(await vm.runInContext('resolveDmgbuild()', context)).toBe(
    path.join('/vendor', 'dmgbuild'),
  );
  expect(calls[0]).toEqual([
    'dmg-builder@1.2.0',
    'dmgbuild-bundle-arm64-75c8a6c.tar.gz',
    'a785f2a385c8c31996a089ef8e26361904b40c772d5ea65a36001212f1fc25e0',
    'electron-userland/electron-builder-binaries',
  ]);
});

it('preserves the final packaging failure exit code', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codesign-dmg-test-'));
  try {
    const script = readFileSync(new URL('./package-macos-dmg.sh', import.meta.url), 'utf8');
    writeFileSync(path.join(dir, 'package.sh'), script);
    writeFileSync(path.join(dir, 'electron-builder-macos.cjs'), 'process.exit(23);');
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
    const result = spawnSync(bash, ['package.sh'], {
      cwd: dir,
      env: { ...process.env, CODESIGN_DMG_BUILD_RETRIES: '1' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(23);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
