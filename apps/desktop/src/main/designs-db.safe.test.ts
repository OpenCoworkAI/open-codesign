/**
 * Boot-time guard: when better-sqlite3 fails to open the file (corrupt DB,
 * missing directory, permission denied, etc.) safeInitSnapshotsDb must
 * capture the error instead of rethrowing — otherwise the failure would
 * reject app.whenReady() and prevent the BrowserWindow from opening.
 */

import { describe, expect, it } from 'vitest';
import { safeInitSnapshotsDb } from './snapshots-db';

describe('safeInitSnapshotsDb', () => {
  it('returns { ok: false, error } when better-sqlite3 throws — does not rethrow', () => {
    // Pointing at a path inside a directory that does not exist makes
    // better-sqlite3 throw synchronously on open. The wrapper must catch
    // it so app boot can proceed without snapshots.
    const result = safeInitSnapshotsDb('/nonexistent-dir-for-test/designs.db');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure path');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});
