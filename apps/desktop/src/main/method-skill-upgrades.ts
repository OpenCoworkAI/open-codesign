import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from './logger';
import {
  isMethodSkillName,
  METHOD_SKILL_HISTORY,
  type MethodSkillName,
} from './method-skill-history';

const logger = getLogger('method-skill-upgrades');
const STATE_DIR = '.codesign-skill-upgrades';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface MethodSkillUpgradeCounts {
  installed: number;
  updated: number;
  unchanged: number;
  preserved: number;
  recovered: number;
  failed: number;
}

interface Intent {
  schemaVersion: 1;
  name: MethodSkillName;
  previousHash: string;
  installedHash: string;
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function isUnsupportedLink(error: unknown): boolean {
  return ['ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].some((code) => hasCode(error, code));
}

async function info(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/** Check every existing component, including the root's parents; never traverse a link/junction. */
export async function isUnlinkedPath(file: string): Promise<boolean> {
  let current = path.resolve(file);
  while (true) {
    const entry = await info(current);
    if (entry?.isSymbolicLink()) return false;
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

async function regularBytes(file: string): Promise<Buffer | null> {
  if (!(await isUnlinkedPath(file))) throw new Error(`Linked path is not eligible: ${file}`);
  const before = await info(file);
  if (!before) return null;
  if (!before.isFile() || before.nlink !== 1)
    throw new Error(`Expected an unlinked regular file: ${file}`);
  const bytes = await readFile(file);
  const after = await info(file);
  if (
    !after ||
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size
  ) {
    throw new Error(`File changed while being read: ${file}`);
  }
  return bytes;
}

async function writeExclusive(file: string, bytes: Buffer | string): Promise<void> {
  if (!(await isUnlinkedPath(file))) throw new Error(`Write path changed: ${file}`);
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function knownHash(name: MethodSkillName, value: string): boolean {
  return METHOD_SKILL_HISTORY[name].some(([sha]) => sha === value);
}

function parseIntent(raw: unknown): Intent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error('Invalid upgrade journal');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'installedHash,name,previousHash,schemaVersion' ||
    value['schemaVersion'] !== 1 ||
    typeof value['name'] !== 'string' ||
    !isMethodSkillName(value['name']) ||
    typeof value['previousHash'] !== 'string' ||
    !knownHash(value['name'], value['previousHash']) ||
    typeof value['installedHash'] !== 'string' ||
    !SHA256.test(value['installedHash'])
  ) {
    throw new Error('Invalid upgrade journal schema, skill name or historical hash');
  }
  return {
    schemaVersion: 1,
    name: value['name'],
    previousHash: value['previousHash'],
    installedHash: value['installedHash'],
  };
}

function receiptBytes(intent: Intent, installed: boolean): string {
  return JSON.stringify({
    ...intent,
    installedHash: installed ? intent.installedHash : null,
    outcome: installed ? 'installed' : 'preserved-or-recovered',
  });
}

async function validateReceipt(tx: string, intent: Intent): Promise<boolean> {
  const receipt = path.join(tx, 'receipt.json');
  const entry = await info(receipt);
  if (!entry) return false;
  if (!entry.isFile() || !(await isUnlinkedPath(receipt)))
    throw new Error(`Unsafe receipt: ${receipt}`);
  const staged = await info(path.join(tx, 'receipt.tmp'));
  if (
    entry.nlink !== 1 &&
    !(entry.nlink === 2 && staged?.ino === entry.ino && staged.dev === entry.dev)
  ) {
    throw new Error(`Externally linked receipt: ${receipt}`);
  }
  const content = await readFile(receipt, 'utf8');
  if (![receiptBytes(intent, true), receiptBytes(intent, false)].includes(content)) {
    throw new Error(`Conflicting or corrupt receipt: ${receipt}`);
  }
  return true;
}

async function finish(tx: string, installed: boolean): Promise<void> {
  const raw = await regularBytes(path.join(tx, 'pending.json'));
  if (!raw) throw new Error(`Missing journal: ${tx}`);
  const intent = parseIntent(JSON.parse(raw.toString('utf8')));
  const hasReceipt = await validateReceipt(tx, intent);
  for (const file of ['staged.md', 'probe.md', 'restore.md', 'receipt.tmp']) {
    if (await info(path.join(tx, file))) await unlink(path.join(tx, file));
  }
  const receipt = path.join(tx, 'receipt.json');
  if (!hasReceipt) {
    const stage = path.join(tx, 'receipt.tmp');
    await writeExclusive(stage, receiptBytes(intent, installed));
    await link(stage, receipt);
    await unlink(stage);
  }
  await unlink(path.join(tx, 'pending.json'));
}

async function recoverTransaction(tx: string, dest: string, source: string): Promise<void> {
  if (!(await isUnlinkedPath(tx)) || !(await info(tx))?.isDirectory())
    throw new Error(`Unsafe recovery directory: ${tx}`);
  const pending = path.join(tx, 'pending.json');
  const raw = await regularBytes(pending);
  if (!raw) {
    // A receipt is never authority to change a skill; an unjournaled preparation has not moved it.
    if (await info(path.join(tx, 'original.md'))) {
      if (!(await info(path.join(tx, 'receipt.json'))))
        throw new Error(`Backup without journal: ${tx}`);
    }
    return;
  }
  const intent = parseIntent(JSON.parse(raw.toString('utf8')));
  const target = await regularBytes(path.join(source, 'skills', intent.name));
  if (
    !target ||
    (hash(target) !== intent.installedHash && !knownHash(intent.name, intent.installedHash))
  ) {
    throw new Error(`Journal target is not a known bundled version: ${pending}`);
  }
  await validateReceipt(tx, intent);
  const candidate = path.join(dest, 'skills', intent.name);
  const original = path.join(tx, 'original.md');
  if (!(await isUnlinkedPath(candidate)))
    throw new Error(`Recovery preserves linked candidate: ${candidate}`);
  const backup = await regularBytes(original);
  if (backup && hash(backup) !== intent.previousHash)
    throw new Error(`Backup changed; inspect without overwriting: ${original}`);
  if (!backup && !(await info(candidate)))
    throw new Error(`Missing candidate and backup: ${candidate}; ${tx}`);
  if (backup && !(await info(candidate))) {
    // Atomic no-replace restoration. Never restore over a file created by another process.
    try {
      const restore = path.join(tx, 'restore.md');
      if (await info(restore)) await unlink(restore);
      await writeExclusive(restore, backup);
      await link(restore, candidate);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  }
  const candidateInfo = await info(candidate);
  const installed =
    candidateInfo?.isFile() && !candidateInfo.isSymbolicLink()
      ? hash(await readFile(candidate)) === intent.installedHash
      : false;
  await finish(tx, installed);
}

async function recover(dest: string, source: string): Promise<number> {
  const state = path.join(dest, STATE_DIR);
  if (!(await info(state))) return 0;
  if (!(await isUnlinkedPath(state)) || !(await info(state))?.isDirectory())
    throw new Error(`Unsafe upgrade state directory: ${state}`);
  let recovered = 0;
  for (const entry of await readdir(state, { withFileTypes: true })) {
    if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink())
      throw new Error(`Unrecognized recovery entry: ${path.join(state, entry.name)}`);
    const tx = path.join(state, entry.name);
    if (await info(path.join(tx, 'pending.json'))) {
      try {
        await recoverTransaction(tx, dest, source);
      } catch (cause) {
        throw new Error(
          `Method skill recovery stopped; inspect ${tx} before retrying: ${String(cause)}`,
          { cause },
        );
      }
      recovered++;
    } else if (await info(path.join(tx, 'receipt.json'))) {
      try {
        const raw = await regularBytes(path.join(tx, 'receipt.json'));
        if (!raw) throw new Error(`Unreadable receipt: ${tx}`);
        const receipt: unknown = JSON.parse(raw.toString('utf8'));
        if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
          throw new Error(`Corrupt receipt: ${tx}`);
        }
        const value = receipt as Record<string, unknown>;
        if (
          Object.keys(value).sort().join(',') !==
            'installedHash,name,outcome,previousHash,schemaVersion' ||
          !(
            (value['outcome'] === 'installed' && typeof value['installedHash'] === 'string') ||
            (value['outcome'] === 'preserved-or-recovered' && value['installedHash'] === null)
          )
        ) {
          throw new Error(`Corrupt receipt: ${tx}`);
        }
        const intent = parseIntent({
          schemaVersion: value['schemaVersion'],
          name: value['name'],
          previousHash: value['previousHash'],
          installedHash: value['installedHash'] ?? value['previousHash'],
        });
        const target = await regularBytes(path.join(source, 'skills', intent.name));
        if (
          !knownHash(intent.name, intent.installedHash) &&
          (!target || hash(target) !== intent.installedHash)
        ) {
          throw new Error(`Unknown receipt version: ${tx}`);
        }
        // Completed receipts are checked for corruption, but never replayed or used to adopt user bytes.
      } catch (cause) {
        throw new Error(
          `Invalid completed skill-upgrade receipt; inspect ${tx}: ${String(cause)}`,
          { cause },
        );
      }
    } else if (await info(path.join(tx, 'original.md'))) {
      throw new Error(`Backup without journal; inspect ${tx}`);
    }
  }
  return recovered;
}

async function recoverInstallStages(dest: string, source: string): Promise<number> {
  const dir = path.join(dest, 'skills');
  if (!(await info(dir)) || !(await isUnlinkedPath(dir))) return 0;
  let recovered = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = Object.keys(METHOD_SKILL_HISTORY).find((name) =>
      entry.name.startsWith(`.skill-${name}.`),
    );
    if (!name || !isMethodSkillName(name) || !entry.name.endsWith('.tmp')) continue;
    const id = entry.name.slice(`.skill-${name}.`.length, -4);
    if (!UUID.test(id)) continue;
    const stage = path.join(dir, entry.name);
    const candidate = path.join(dir, name);
    const staged = await info(stage);
    const current = await info(candidate);
    if (
      staged?.isFile() &&
      current?.isFile() &&
      staged.nlink === 2 &&
      current.nlink === 2 &&
      staged.ino === current.ino &&
      staged.dev === current.dev &&
      (await isUnlinkedPath(stage)) &&
      (await isUnlinkedPath(candidate))
    ) {
      const bytes = await readFile(stage);
      const bundled = await regularBytes(path.join(source, 'skills', name));
      if (bundled && (hash(bytes) === hash(bundled) || knownHash(name, hash(bytes)))) {
        await unlink(stage);
        recovered++;
        continue;
      }
    }
    logger.warn('skill.install_stage.preserved', { candidate, recoveryPath: stage });
  }
  return recovered;
}

async function replaceKnown(
  dest: string,
  source: string,
  name: MethodSkillName,
  before: Buffer,
  target: Buffer,
): Promise<'updated' | 'preserved' | 'failed'> {
  const state = path.join(dest, STATE_DIR);
  if (!(await isUnlinkedPath(state))) throw new Error(`Unsafe upgrade state directory: ${state}`);
  await mkdir(state, { recursive: true, mode: 0o700 });
  const tx = path.join(state, randomUUID());
  await mkdir(tx, { mode: 0o700 });
  const candidate = path.join(dest, 'skills', name);
  const stage = path.join(tx, 'staged.md');
  const original = path.join(tx, 'original.md');
  const intent: Intent = {
    schemaVersion: 1,
    name,
    previousHash: hash(before),
    installedHash: hash(target),
  };
  try {
    await writeExclusive(stage, target);
    // Establish no-replace support before removing the original path.
    try {
      await link(stage, path.join(tx, 'probe.md'));
    } catch (error) {
      if (!isUnsupportedLink(error)) throw error;
      await unlink(stage);
      await rmdir(tx);
      logger.warn('skill.upgrade.unsupported', {
        candidate,
        recoveryPath: state,
        reason: String(error),
        status: 'failed-preserved-original',
      });
      return 'failed';
    }
    await unlink(path.join(tx, 'probe.md'));
    await writeExclusive(path.join(tx, 'pending.tmp'), JSON.stringify(intent));
    await rename(path.join(tx, 'pending.tmp'), path.join(tx, 'pending.json'));
    const latest = await regularBytes(candidate);
    if (!latest || hash(latest) !== intent.previousHash) {
      await finish(tx, false);
      logger.warn('skill.preserved.concurrent_edit', { candidate, recoveryPath: tx });
      return 'preserved';
    }
    await rename(candidate, original);
    const moved = await regularBytes(original);
    if (!moved || hash(moved) !== intent.previousHash)
      throw new Error(`Concurrent edit retained in ${original}`);
    if (!(await isUnlinkedPath(candidate)) || !(await isUnlinkedPath(tx)))
      throw new Error(`Path changed during upgrade: ${candidate}; ${tx}`);
    const staged = await regularBytes(stage);
    if (!staged || hash(staged) !== intent.installedHash)
      throw new Error(`Staged input changed: ${stage}`);
    await link(stage, candidate);
    await finish(tx, true);
    return 'updated';
  } catch (error) {
    try {
      if (await info(path.join(tx, 'pending.json'))) await recoverTransaction(tx, dest, source);
    } catch (recoveryError) {
      throw new Error(
        `Skill upgrade and recovery failed. Preserve and inspect ${candidate} and ${tx}. ${String(recoveryError)}`,
        { cause: error },
      );
    }
    throw new Error(
      `Skill upgrade failed; existing files were retained or recovered. Inspect ${candidate} and ${tx}`,
      { cause: error },
    );
  }
}

async function installMissing(candidate: string, target: Buffer): Promise<boolean> {
  // Same-directory staging works even when no backup state exists yet.
  const stage = path.join(
    path.dirname(candidate),
    `.skill-${path.basename(candidate)}.${randomUUID()}.tmp`,
  );
  try {
    await writeExclusive(stage, target);
    if (!(await isUnlinkedPath(candidate)))
      throw new Error(`Installation path changed: ${candidate}`);
    try {
      await link(stage, candidate);
    } catch (error) {
      if (!isUnsupportedLink(error)) throw error;
      if (!(await isUnlinkedPath(candidate))) return false;
      // Fresh files retain the old seeder's filesystem support; never replace an existing path.
      await copyFile(stage, candidate, constants.COPYFILE_EXCL);
      logger.info('skill.install.exclusive_copy', {
        candidate,
        reason: String(error),
        status: 'installed-missing-file',
      });
    }
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    if (await info(stage)) await unlink(stage);
  }
}

/** Startup only: run before missing-file copying or starting any model session. */
export async function upgradeMethodSkills(
  dest: string,
  source: string,
): Promise<MethodSkillUpgradeCounts> {
  const counts: MethodSkillUpgradeCounts = {
    installed: 0,
    updated: 0,
    unchanged: 0,
    preserved: 0,
    recovered: 0,
    failed: 0,
  };
  try {
    counts.recovered = await recover(dest, source);
    counts.recovered += await recoverInstallStages(dest, source);
    for (const name of Object.keys(METHOD_SKILL_HISTORY)) {
      if (!isMethodSkillName(name)) continue;
      const candidate = path.join(dest, 'skills', name);
      const bundled = path.join(source, 'skills', name);
      if (!(await info(bundled))) continue;
      const existing = await info(candidate);
      if (
        !(await isUnlinkedPath(candidate)) ||
        (existing && (!existing.isFile() || existing.nlink !== 1)) ||
        !(await isUnlinkedPath(bundled))
      ) {
        counts.preserved++;
        logger.warn('skill.preserved.unsafe_path', { candidate, bundled });
        continue;
      }
      const target = await regularBytes(bundled);
      if (!target) throw new Error(`Bundled skill disappeared: ${bundled}`);
      const before = await regularBytes(candidate);
      if (!before) {
        await mkdir(path.dirname(candidate), { recursive: true });
        if (await installMissing(candidate, target)) counts.installed++;
        else {
          counts.preserved++;
          logger.warn('skill.preserved.concurrent_create', { candidate });
        }
      } else if (hash(before) === hash(target)) {
        counts.unchanged++;
      } else if (!knownHash(name, hash(before))) {
        counts.preserved++;
        logger.info('skill.preserved.custom_or_unknown', { candidate });
      } else {
        const result = await replaceKnown(dest, source, name, before, target);
        if (result === 'updated') counts.updated++;
        else {
          counts.preserved++;
          if (result === 'failed') counts.failed++;
        }
      }
    }
    return counts;
  } catch (error) {
    logger.error('skills.upgrade.failed', {
      dest,
      ...counts,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
