#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { downloadArtifact } = require('app-builder-lib/out/binDownload');

const DMGBUILD_RELEASE = '75c8a6c';
const DMGBUILD_CHECKSUMS = {
  [`dmgbuild-bundle-arm64-${DMGBUILD_RELEASE}.tar.gz`]:
    'a785f2a385c8c31996a089ef8e26361904b40c772d5ea65a36001212f1fc25e0',
  [`dmgbuild-bundle-x86_64-${DMGBUILD_RELEASE}.tar.gz`]:
    '87b3bb72148b11451ee90ede79cc8d59305c9173b68b0f2b50a3bea51fc4a4e2',
};

function dmgbuildArchiveName() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return `dmgbuild-bundle-${arch}-${DMGBUILD_RELEASE}.tar.gz`;
}

async function resolveDmgbuild() {
  const vendorDir = await downloadArtifact({
    releaseName: 'dmg-builder@1.2.0',
    filenameWithExt: dmgbuildArchiveName(),
    checksums: DMGBUILD_CHECKSUMS,
    githubOrgRepo: 'electron-userland/electron-builder-binaries',
  });
  return path.join(vendorDir, 'dmgbuild');
}

function writeDmgbuildWrapper(realDmgbuild) {
  const dir = mkdtempSync(path.join(tmpdir(), 'codesign-dmgbuild-'));
  const wrapper = path.join(dir, 'dmgbuild');
  writeFileSync(
    wrapper,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `exec ${JSON.stringify(realDmgbuild)} --detach-retries "\${CODESIGN_DMG_DETACH_RETRIES:-30}" "$@"`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(wrapper, 0o755);
  return { dir, wrapper };
}

async function main() {
  const realDmgbuild = await resolveDmgbuild();
  const { dir, wrapper } = writeDmgbuildWrapper(realDmgbuild);
  const electronBuilderCli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [electronBuilderCli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, CUSTOM_DMGBUILD_PATH: wrapper },
  });
  rmSync(dir, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exit(1);
});
