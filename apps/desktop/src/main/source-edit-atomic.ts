import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export class SourceEditCommitError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SourceEditCommitError';
  }
}

/** Caller holds the workspace-path lease and canonical writer lease. */
export async function commitSourceEdit(input: {
  destination: string;
  expectedContent: string;
  content: string;
  validate: () => Promise<void>;
}): Promise<{ warning?: string }> {
  const original = await lstat(input.destination);
  if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1) {
    throw new SourceEditCommitError(
      'unsafe-path',
      'Source edits require an unlinked regular file.',
    );
  }
  const stage = path.join(path.dirname(input.destination), `.codesign-edit-${randomUUID()}.tmp`);
  let created = false;
  let committed = false;
  try {
    const handle = await open(stage, 'wx', original.mode & 0o777);
    created = true;
    try {
      await handle.writeFile(input.content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await input.validate();

    const staged = await lstat(stage);
    if (
      !staged.isFile() ||
      staged.isSymbolicLink() ||
      staged.nlink !== 1 ||
      !(await readFile(stage)).equals(Buffer.from(input.content, 'utf8'))
    ) {
      throw new SourceEditCommitError(
        'stage-changed',
        'The staged source changed; no edit was saved.',
      );
    }
    await input.validate();
    const current = await lstat(input.destination);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      !(await readFile(input.destination)).equals(Buffer.from(input.expectedContent, 'utf8'))
    ) {
      throw new SourceEditCommitError(
        'stale-source',
        'The source changed before commit; no edit was saved.',
      );
    }
    // This is an atomic replacement, not an OS compare-and-swap. An external
    // writer can still race the last validation and rename; participating writers
    // are serialized by the caller. No post-commit work may report an unsaved edit.
    await rename(stage, input.destination);
    committed = true;
    return {};
  } finally {
    if (created && !committed) {
      await unlink(stage).catch(() => undefined);
    }
  }
}
