/**
 * SQLite persistence layer for designs, snapshots, and chat messages.
 *
 * Uses better-sqlite3 (synchronous API — safe in the Electron main process,
 * which is the only caller). WAL mode for concurrent read performance.
 *
 * Call initSnapshotsDb(dbPath) once at app start.
 * Call initInMemoryDb() in tests to get an isolated in-memory instance.
 */

import { getLogger } from '../logger';
import { type Database, openDatabase } from './native-binding';
import { applySchema } from './schema';

let singleton: Database | null = null;

/** Initialize and return the singleton DB instance for production use. */
export function initSnapshotsDb(dbPath: string): Database {
  if (singleton) return singleton;
  const db = openDatabase(dbPath);
  try {
    applySchema(db);
  } catch (cause) {
    // Don't cache a half-open DB — let the next caller retry from scratch.
    try {
      db.close();
    } catch (closeErr) {
      const logger = getLogger('snapshots-db');
      logger.warn('db.init.close_failed', { cause: closeErr });
    }
    throw cause;
  }
  singleton = db;
  return singleton;
}

/**
 * Boot-time wrapper that never throws. Returns either the live DB or the
 * underlying error, so the caller can degrade gracefully without blocking
 * the BrowserWindow from opening when snapshot persistence is unavailable
 * (e.g. corrupt file, permission denied, native binding missing).
 */
export function safeInitSnapshotsDb(
  dbPath: string,
): { ok: true; db: Database } | { ok: false; error: Error } {
  try {
    return { ok: true, db: initSnapshotsDb(dbPath) };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { ok: false, error };
  }
}

/** For use in Vitest tests only — returns a fresh isolated in-memory instance. */
export function initInMemoryDb(): Database {
  // ':memory:' as filename creates an in-memory database in better-sqlite3.
  const db = openDatabase(':memory:');
  applySchema(db);
  return db;
}

export {
  appendChatMessage,
  clearChatMessages,
  listChatMessages,
  seedChatFromSnapshots,
  updateChatToolCallStatus,
} from './chat-messages';
export {
  createComment,
  deleteComment,
  listComments,
  listPendingEdits,
  markCommentsApplied,
  updateComment,
} from './comments';
export {
  createDesignFile,
  insertInDesignFile,
  listDesignFiles,
  listDesignFilesInDir,
  normalizeDesignFilePath,
  strReplaceInDesignFile,
  upsertDesignFile,
  viewDesignFile,
} from './design-files';
export {
  clearDesignWorkspace,
  createDesign,
  deleteDesignForRollback,
  duplicateDesign,
  getDesign,
  listDesigns,
  renameDesign,
  setDesignThumbnail,
  softDeleteDesign,
  updateDesignWorkspace,
} from './designs';
export {
  getDiagnosticEventById,
  listDiagnosticEvents,
  pruneDiagnosticEvents,
  recordDiagnosticEvent,
} from './diagnostics';
export { resolveNativeBinding, resolveNativeBindingPath } from './native-binding';
export {
  createSnapshot,
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
} from './snapshots';
