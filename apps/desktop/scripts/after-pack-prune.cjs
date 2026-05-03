const fs = require('node:fs');
const path = require('node:path');

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
};

function archName(arch) {
  return typeof arch === 'number' ? (ARCH_NAMES[arch] ?? String(arch)) : String(arch);
}

function sleepSync(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Busy wait is acceptable here: this is a short build-time retry delay.
  }
}

function withRmRetry(fn) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      fn();
      return;
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(err?.code) || attempt === 3) {
        throw err;
      }
      sleepSync(50 * (attempt + 1));
    }
  }
}

function rm(target) {
  const pending = [target];
  const directories = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }
    if (!stat.isDirectory()) {
      withRmRetry(() => fs.unlinkSync(current));
      continue;
    }
    directories.push(current);
    for (const entry of fs.readdirSync(current)) {
      pending.push(path.join(current, entry));
    }
  }
  for (const dir of directories.reverse()) {
    withRmRetry(() => fs.rmdirSync(dir));
  }
}

function existingDirs(paths) {
  return paths.filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
}

function resourcesDirs(context) {
  const productName = context.packager?.appInfo?.productFilename ?? context.packager?.appInfo?.name;
  const candidates = [];
  if (productName) {
    candidates.push(path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources'));
  }
  candidates.push(path.join(context.appOutDir, 'resources'));
  return existingDirs(candidates);
}

function unpackedNodeModulesDirs(context) {
  return existingDirs(
    resourcesDirs(context).map((resourcesDir) =>
      path.join(resourcesDir, 'app.asar.unpacked', 'node_modules'),
    ),
  );
}

function koffiTriplet(platform, arch) {
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'darwin_arm64';
    if (arch === 'x64') return 'darwin_x64';
  }
  if (platform === 'win32') {
    if (arch === 'arm64') return 'win32_arm64';
    if (arch === 'ia32') return 'win32_ia32';
    if (arch === 'x64') return 'win32_x64';
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return 'linux_arm64';
    if (arch === 'armv7l') return 'linux_armhf';
    if (arch === 'ia32') return 'linux_ia32';
    if (arch === 'x64') return 'linux_x64';
  }
  return null;
}

function pruneKoffi(nodeModulesDir, platform, arch) {
  const pkgDir = path.join(nodeModulesDir, 'koffi');
  const buildRoot = path.join(pkgDir, 'build', 'koffi');
  if (!fs.existsSync(buildRoot)) return;

  rm(path.join(pkgDir, 'src'));
  rm(path.join(pkgDir, 'vendor'));
  const keep = koffiTriplet(platform, arch);
  if (keep === null || !fs.existsSync(path.join(buildRoot, keep))) return;

  for (const name of fs.readdirSync(buildRoot)) {
    if (name !== keep) rm(path.join(buildRoot, name));
  }
}

function pruneUnpackedRuntimeNoise(nodeModulesDir) {
  for (const packageName of ['jszip']) {
    const pkgDir = path.join(nodeModulesDir, packageName);
    rm(path.join(pkgDir, 'docs'));
    rm(path.join(pkgDir, 'doc'));
    rm(path.join(pkgDir, 'test'));
    rm(path.join(pkgDir, 'tests'));
    rm(path.join(pkgDir, 'example'));
    rm(path.join(pkgDir, 'examples'));
    rm(path.join(pkgDir, 'vendor'));
  }
}

module.exports = async function afterPackPrune(context) {
  const platform = context.electronPlatformName ?? process.platform;
  const arch = archName(context.arch);
  for (const nodeModulesDir of unpackedNodeModulesDirs(context)) {
    pruneKoffi(nodeModulesDir, platform, arch);
    pruneUnpackedRuntimeNoise(nodeModulesDir);
  }
};
