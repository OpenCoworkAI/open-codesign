import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { DesignSourceEntryV1 } from '@open-codesign/shared';
import type { Database } from './snapshots-db';

export class SourceEntryError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceEntryError';
  }
}

export function sourceEntryFile(db: Database, designId: string): string {
  if (!path.isAbsolute(db.sessionDir)) {
    throw new SourceEntryError(
      'invalid-storage',
      'Source entries require an absolute session directory.',
    );
  }
  if (!designId.trim()) throw new SourceEntryError('invalid-input', 'A design ID is required.');
  return path.join(
    db.sessionDir,
    'source-entries',
    `${createHash('sha256').update(designId).digest('hex')}.json`,
  );
}

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function safeDirectory(directory: string, create: boolean): Promise<boolean> {
  const parent = path.dirname(directory);
  if (parent !== directory && !(await safeDirectory(parent, create))) return false;
  let entry: Stats;
  try {
    entry = await lstat(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (!create) return false;
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    }
    entry = await lstat(directory);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new SourceEntryError(
      'unsafe-path',
      'Source-entry storage must use unlinked directories.',
    );
  }
  return true;
}

export async function readSourceEntryFile(
  db: Database,
  designId: string,
): Promise<DesignSourceEntryV1 | null> {
  const file = sourceEntryFile(db, designId);
  if (!(await safeDirectory(path.dirname(file), false))) return null;
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new SourceEntryError(
      'unsafe-path',
      'Source-entry metadata must be an unlinked regular file.',
    );
  }
  if (info.size > 64 * 1024)
    throw new SourceEntryError('invalid-metadata', 'Source-entry metadata is too large.');
  const handle = await open(file, 'r');
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (
      opened.dev !== info.dev ||
      opened.ino !== info.ino ||
      opened.nlink !== 1 ||
      !opened.isFile()
    ) {
      throw new SourceEntryError('unsafe-path', 'Source-entry metadata changed while opening it.');
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(file);
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      after.nlink !== 1 ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.isSymbolicLink() ||
      current.nlink !== 1
    ) {
      throw new SourceEntryError(
        'invalid-metadata',
        'Source-entry metadata changed while reading it.',
      );
    }
    await safeDirectory(path.dirname(file), false);
  } finally {
    await handle.close();
  }
  if (bytes.length > 64 * 1024)
    throw new SourceEntryError('invalid-metadata', 'Source-entry metadata is too large.');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const entry = DesignSourceEntryV1.parse(JSON.parse(text));
    if (entry.designId !== designId) throw new Error('Design ID mismatch');
    return entry;
  } catch {
    throw new SourceEntryError(
      'invalid-metadata',
      'Source-entry metadata is invalid or uses an unsupported schema.',
    );
  }
}

export async function writeSourceEntryFile(
  db: Database,
  designId: string,
  entry: DesignSourceEntryV1,
  previous: DesignSourceEntryV1 | null,
  validate: () => Promise<void>,
): Promise<void> {
  DesignSourceEntryV1.parse(entry);
  if (entry.designId !== designId)
    throw new SourceEntryError(
      'invalid-metadata',
      'Source-entry design ID does not match its storage key.',
    );
  const file = sourceEntryFile(db, designId);
  const directory = path.dirname(file);
  await safeDirectory(directory, true);
  const canonicalDirectory = await realpath(directory);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await validate();
    if (
      JSON.stringify(await readSourceEntryFile(db, designId)) !==
      JSON.stringify(previous === null ? null : DesignSourceEntryV1.parse(previous))
    ) {
      throw new SourceEntryError(
        'revision-changed',
        'Source-entry metadata changed; reload it before retrying.',
      );
    }
    await safeDirectory(directory, false);
    if ((await realpath(directory)) !== canonicalDirectory) {
      throw new SourceEntryError('unsafe-path', 'Source-entry storage changed before saving.');
    }
    // This coordinates app writers; rename is not an OS-level compare-and-swap.
    await rename(temporary, file);
    created = false;
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

export async function removeSourceEntryFile(db: Database, designId: string): Promise<void> {
  if ((await readSourceEntryFile(db, designId)) !== null) await rm(sourceEntryFile(db, designId));
}
