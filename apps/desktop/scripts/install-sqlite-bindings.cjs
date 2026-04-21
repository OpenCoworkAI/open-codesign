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
 *   build/Release/better_sqlite3.node-node.node          (Node ABI, used by vitest)
 *   build/Release/better_sqlite3.node-electron-x64.node  (Electron ABI, x64 app)
 *   build/Release/better_sqlite3.node-electron-arm64.node(Electron ABI, arm64 app)
 *   build/Release/better_sqlite3.node-electron.node      (legacy alias for host arch)
 *
 * snapshots-db.ts then opts into the right file via better-sqlite3's
 * `nativeBinding` constructor option, depending on whether process.versions.electron
 * is defined.
 *
 * Idempotent - skips downloads when both stashed binaries already match the
 * recorded versions in install-sqlite-bindings.lock.json. Safe to re-run on
 * every install.
 *
 * SchemaVersion 2: marker for the on-disk lock format so we can migrate later
 * without breaking older checkouts.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LOCK_SCHEMA_VERSION = 2;

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

function electronTargetArches(platform, hostArch) {
  if (platform === 'darwin' || platform === 'win32') {
    return ['x64', 'arm64'];
  }
  return [hostArch];
}

function resolvePrebuildInstallEntrypoint(pkgDir) {
  try {
    return require.resolve('prebuild-install/bin.js', { paths: [pkgDir] });
  } catch {
    throw new Error(
      `prebuild-install/bin.js could not be resolved from ${pkgDir} - better-sqlite3 install layout changed?`,
    );
  }
}

function runPrebuildInstall({ pkgDir, runtime, target, arch, platform }) {
  const prebuildEntrypoint = resolvePrebuildInstallEntrypoint(pkgDir);
  try {
    const output = execFileSync(
      process.execPath,
      [
        prebuildEntrypoint,
        `--runtime=${runtime}`,
        `--target=${target}`,
        `--arch=${arch}`,
        `--platform=${platform}`,
      ],
      { cwd: pkgDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (output) process.stdout.write(output);
  } catch (error) {
    if (error && typeof error === 'object') {
      if (typeof error.stdout === 'string' && error.stdout.length > 0)
        process.stdout.write(error.stdout);
      if (typeof error.stderr === 'string' && error.stderr.length > 0)
        process.stderr.write(error.stderr);
    }
    throw error;
  }
}

function isMissingPrebuild(error) {
  const stdout =
    error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
  const stderr =
    error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr
      : '';
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return /No prebuilt binaries found/i.test(`${stdout}\n${stderr}\n${message}`);
}

function downloadPrebuild({ pkgDir, runtime, target, arch, platform, dest, optional }) {
  const defaultBinary = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  // Move out of the way so prebuild-install doesn't short-circuit.
  if (fs.existsSync(defaultBinary)) fs.rmSync(defaultBinary);

  try {
    runPrebuildInstall({ pkgDir, runtime, target, arch, platform });
  } catch (error) {
    if (optional && isMissingPrebuild(error)) {
      log(`no published prebuild for ${runtime}@${target} (${platform}-${arch}); skipping`);
      return false;
    }
    throw error;
  }

  if (!fs.existsSync(defaultBinary)) {
    throw new Error(`prebuild-install for ${runtime}@${target} did not produce ${defaultBinary}`);
  }
  fs.copyFileSync(defaultBinary, dest);
  fs.rmSync(defaultBinary);
  return true;
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
  const electronArches = electronTargetArches(platform, arch);
  const electronBinaries = Object.fromEntries(
    electronArches.map((targetArch) => [
      targetArch,
      path.join(releaseDir, `better_sqlite3.node-electron-${targetArch}.node`),
    ]),
  );
  const legacyElectronBinary = path.join(releaseDir, 'better_sqlite3.node-electron.node');
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
    hasNodeBinary: fs.existsSync(nodeBinary),
    electronArches,
    hasElectronBinaries: Object.fromEntries(
      electronArches.map((targetArch) => [targetArch, fs.existsSync(electronBinaries[targetArch])]),
    ),
  };

  const upToDate =
    lock !== null &&
    lock.schemaVersion === LOCK_SCHEMA_VERSION &&
    lock.arch === arch &&
    lock.platform === platform &&
    lock.nodeVersion === nodeVersion &&
    lock.electronVersion === electronVersion &&
    lock.hasNodeBinary === targetLock.hasNodeBinary &&
    JSON.stringify(lock.electronArches) === JSON.stringify(targetLock.electronArches) &&
    JSON.stringify(lock.hasElectronBinaries) === JSON.stringify(targetLock.hasElectronBinaries) &&
    (!targetLock.hasNodeBinary || fs.existsSync(nodeBinary)) &&
    electronArches.every(
      (targetArch) =>
        targetLock.hasElectronBinaries[targetArch] !== true ||
        fs.existsSync(electronBinaries[targetArch]),
    );

  if (upToDate) {
    log(
      `up-to-date (node=${nodeVersion}, electron=${electronVersion ?? 'skipped'}, ${platform}-${arch}) - skipping`,
    );
    return;
  }

  log(`downloading Node prebuild (node=${nodeVersion}, ${platform}-${arch})`);
  const hasNodeBinary = downloadPrebuild({
    pkgDir,
    runtime: 'node',
    target: nodeVersion,
    arch,
    platform,
    dest: nodeBinary,
    optional: true,
  });

  const hasElectronBinaries = {};
  if (electronVersion === null) {
    log('electron not installed; skipping Electron native binding (fine for prod-only installs)');
  } else {
    for (const targetArch of electronArches) {
      log(`downloading Electron prebuild (electron=${electronVersion}, ${platform}-${targetArch})`);
      hasElectronBinaries[targetArch] = downloadPrebuild({
        pkgDir,
        runtime: 'electron',
        target: electronVersion,
        arch: targetArch,
        platform,
        dest: electronBinaries[targetArch],
        optional: false,
      });
    }
  }

  if (!hasNodeBinary && !electronArches.some((targetArch) => hasElectronBinaries[targetArch])) {
    throw new Error('Failed to stage any better-sqlite3 native bindings');
  }

  // Leave a default copy in place so any consumer that doesn't pass nativeBinding
  // (e.g. ad-hoc node REPL inside this monorepo) still gets a working module.
  // Prefer the Node binary when available; otherwise fall back to the Electron
  // binary so the desktop app still boots on machines where upstream has not
  // published a Node prebuild for the active version yet.
  const defaultBinary = path.join(releaseDir, 'better_sqlite3.node');
  if (hasNodeBinary) {
    fs.copyFileSync(nodeBinary, defaultBinary);
  } else {
    const firstElectronArch = electronArches.find((targetArch) => hasElectronBinaries[targetArch]);
    if (firstElectronArch) fs.copyFileSync(electronBinaries[firstElectronArch], defaultBinary);
  }

  const hostElectronBinary = electronBinaries[arch];
  if (hostElectronBinary && fs.existsSync(hostElectronBinary)) {
    fs.copyFileSync(hostElectronBinary, legacyElectronBinary);
  } else if (fs.existsSync(legacyElectronBinary)) {
    fs.rmSync(legacyElectronBinary);
  }

  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({ ...targetLock, hasNodeBinary, hasElectronBinaries }, null, 2)}\n`,
  );
  log('done');
}

main();
