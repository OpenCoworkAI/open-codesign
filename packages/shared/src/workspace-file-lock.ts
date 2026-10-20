import { realpath } from 'node:fs/promises';
import path from 'node:path';

const writers = new Map<string, Promise<void>>();

async function canonicalFileKey(filePath: string): Promise<string> {
  let existingPath = path.resolve(filePath);
  const missingParts: string[] = [];
  while (true) {
    try {
      const canonicalPath = path.join(await realpath(existingPath), ...missingParts);
      return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw error;
      missingParts.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }
}

/**
 * Serializes participating main-process writers, including different designs
 * bound to the same workspace. Hold the workspace rename lease before entering.
 * This is not an OS lock: external processes and hard-link aliases do not
 * participate. Callers must still check expected disk content inside the lease.
 */
export async function withWorkspaceFileWriter<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = await canonicalFileKey(filePath);
  const previous = writers.get(key) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  writers.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writers.get(key) === queued) writers.delete(key);
  }
}
