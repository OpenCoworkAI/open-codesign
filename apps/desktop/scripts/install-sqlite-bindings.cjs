#!/usr/bin/env node
/**
 * Dual-target native binding installer for better-sqlite3.
 *
 * better-sqlite3 ships a single prebuilt .node file at
 *   build/Release/better_sqlite3.node
 * which can target either Node's ABI or Electron's ABI but not both. The desktop
 * app needs Electron at runtime; vitest needs Node. To keep both working from a
 * single `pnpm install`, we download both prebuilds and stash them at:
 *
 *   build/Release/better_sqlite3.node-node.node     (Node ABI, used by vitest)
 *   build/Release/better_sqlite3.node-electron.node (Electron ABI, used by app)
 *
 * snapshots-db.ts then opts into the right file via better-sqlite3's
 * `nativeBinding` constructor option, depending on whether process.versions.electron
 * is defined.
 *
 * Idempotent — skips downloads when both stashed binaries already match the
 * recorded versions in install-sqlite-bindings.lock.json. Safe to re-run on
 * every install.
 *
 * SchemaVersion 1: marker for the on-disk lock format so we can migrate later
 * without breaking older checkouts.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LOCK_SCHEMA_VERSION = 1;

function log(msg) {
  process.stdout.write(`[sqlite-bindings] ${msg}\n`);
}

function resolveBetterSqlite3Dir() {
  // require.resolve walks pnpm symlinks to the real install dir.
  const pkgJsonPath = require.resolve('better-sqlite3/package.json', {
    paths: [path.join(__dirname, '..')],
  });
  return path.dirname(pkgJsonPath);
}

function resolveElectronVersion() {
  // Prod-only installs (`npm install --omit=dev`, certain CI bootstraps, end-user
  // installer build steps) skip devDependencies, so electron may not be present.
  // Skip the Electron stage rather than hard-failing postinstall.
  try {
    return require('electron/package.json').version;
  } catch {
    return null;
  }
}

function downloadPrebuild({ pkgDir, runtime, target, arch, platform, dest }) {
  const prebuildBin = path.join(pkgDir, 'node_modules', '.bin', 'prebuild-install');
  if (!fs.existsSync(prebuildBin)) {
    throw new Error(
      `prebuild-install not found at ${prebuildBin} — better-sqlite3 install layout changed?`,
    );
  }
  const defaultBinary = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  // Move out of the way so prebuild-install doesn't short-circuit.
  if (fs.existsSync(defaultBinary)) fs.rmSync(defaultBinary);

  execFileSync(
    prebuildBin,
    [`--runtime=${runtime}`, `--target=${target}`, `--arch=${arch}`, `--platform=${platform}`],
    { cwd: pkgDir, stdio: 'inherit' },
  );

  if (!fs.existsSync(defaultBinary)) {
    throw new Error(`prebuild-install for ${runtime}@${target} did not produce ${defaultBinary}`);
  }
  fs.copyFileSync(defaultBinary, dest);
  fs.rmSync(defaultBinary);
}

function main() {
  const pkgDir = resolveBetterSqlite3Dir();
  const releaseDir = path.join(pkgDir, 'build', 'Release');
  fs.mkdirSync(releaseDir, { recursive: true });

  const arch = process.arch;
  const platform = process.platform;
  const nodeVersion = process.versions.node;
  const electronVersion = resolveElectronVersion();

  const nodeBinary = path.join(releaseDir, 'better_sqlite3.node-node.node');
  const electronBinary = path.join(releaseDir, 'better_sqlite3.node-electron.node');
  const lockPath = path.join(releaseDir, 'install-sqlite-bindings.lock.json');

  const lock = (() => {
    if (!fs.existsSync(lockPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      return null;
    }
  })();

  const targetLock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    arch,
    platform,
    nodeVersion,
    electronVersion,
  };

  const upToDate =
    lock !== null &&
    lock.schemaVersion === LOCK_SCHEMA_VERSION &&
    lock.arch === arch &&
    lock.platform === platform &&
    lock.nodeVersion === nodeVersion &&
    lock.electronVersion === electronVersion &&
    fs.existsSync(nodeBinary) &&
    (electronVersion === null || fs.existsSync(electronBinary));

  if (upToDate) {
    log(
      `up-to-date (node=${nodeVersion}, electron=${electronVersion ?? 'skipped'}, ${platform}-${arch}) — skipping`,
    );
    return;
  }

  log(`downloading Node prebuild (node=${nodeVersion}, ${platform}-${arch})`);
  downloadPrebuild({
    pkgDir,
    runtime: 'node',
    target: nodeVersion,
    arch,
    platform,
    dest: nodeBinary,
  });

  if (electronVersion === null) {
    log('electron not installed; skipping Electron native binding (fine for prod-only installs)');
  } else {
    log(`downloading Electron prebuild (electron=${electronVersion}, ${platform}-${arch})`);
    downloadPrebuild({
      pkgDir,
      runtime: 'electron',
      target: electronVersion,
      arch,
      platform,
      dest: electronBinary,
    });
  }

  // Leave a default copy in place so any consumer that doesn't pass nativeBinding
  // (e.g. ad-hoc node REPL inside this monorepo) still gets a working module
  // matching the active runtime.
  const defaultBinary = path.join(releaseDir, 'better_sqlite3.node');
  fs.copyFileSync(nodeBinary, defaultBinary);

  fs.writeFileSync(lockPath, `${JSON.stringify(targetLock, null, 2)}\n`);
  log('done');
}

main();
