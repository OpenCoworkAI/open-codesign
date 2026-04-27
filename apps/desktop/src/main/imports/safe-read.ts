import { readFile, stat } from 'node:fs/promises';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { getLogger } from '../logger';

/**
 * Defensive reader for user-scoped import config files. Attackers with write
 * access to a user's home directory (malicious dotfile drop, compromised
 * npm global, shared machine) can otherwise:
 *
 *   - symlink `~/.codex/config.toml` → `/dev/zero` and OOM the main
 *     process on next `detect-external-configs` call;
 *   - plant a 10-GB file at the same path and exhaust the heap;
 *   - point the path at a socket / FIFO / directory to hang `readFile`.
 *
 * `safeReadImportFile` stats first, rejects anything that isn't a regular
 * file or that exceeds `MAX_IMPORT_FILE_BYTES`, and falls through to
 * `readFile` only when the stat says it's safe. Returns `null` only when
 * the path is absent. Present-but-unreadable, non-regular, or oversized
 * files are configuration errors and must surface to direct import calls
 * rather than looking like "no config found".
 */
const log = getLogger('import-read');

/** Every real CLI config we import is < 32 KB. 256 KB leaves plenty of
 *  headroom for a user who goes wild with comments or adds many providers,
 *  while killing the "symlink to /dev/zero" attack cleanly. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export async function safeReadImportFile(path: string): Promise<string | null> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    log.warn('safe_read.stat_failed', { path, code: code ?? 'unknown' });
    throw new CodesignError(
      `Could not inspect import config file at ${path}`,
      ERROR_CODES.CONFIG_READ_FAILED,
      { cause: err },
    );
  }
  if (!stats.isFile()) {
    // Symlink to /dev/zero, symlink to a directory, named pipe, etc.
    // `isFile()` follows symlinks, so a symlink to a regular file is fine.
    log.warn('safe_read.not_regular_file', { path });
    throw new CodesignError(
      `Import config path is not a regular file: ${path}`,
      ERROR_CODES.CONFIG_READ_FAILED,
    );
  }
  if (stats.size > MAX_IMPORT_FILE_BYTES) {
    log.warn('safe_read.size_exceeded', {
      path,
      size: stats.size,
      cap: MAX_IMPORT_FILE_BYTES,
    });
    throw new CodesignError(
      `Import config file is too large: ${path}`,
      ERROR_CODES.CONFIG_READ_FAILED,
    );
  }
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    throw new CodesignError(
      `Could not read import config file at ${path}`,
      ERROR_CODES.CONFIG_READ_FAILED,
      { cause: err },
    );
  }
}
