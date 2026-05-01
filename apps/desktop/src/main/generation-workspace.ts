import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { getDesign } from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';

type Database = BetterSqlite3.Database;

export function resolveGenerationWorkspaceRoot(
  db: Database | null,
  designId: string | undefined,
): { designId: string; workspaceRoot: string } {
  if (designId === undefined) {
    throw new CodesignError(
      'Generation requires an active design workspace',
      ERROR_CODES.WORKSPACE_MISSING,
    );
  }
  if (db === null) {
    throw new CodesignError(
      'Snapshots database is unavailable; cannot resolve the design workspace',
      ERROR_CODES.SNAPSHOTS_UNAVAILABLE,
    );
  }
  const design = getDesign(db, designId);
  if (design === null) {
    throw new CodesignError('Design not found', ERROR_CODES.IPC_NOT_FOUND);
  }
  if (design.workspacePath === null) {
    throw new CodesignError(
      'This design has no workspace bound. Reopen the design from the dashboard.',
      ERROR_CODES.WORKSPACE_MISSING,
    );
  }
  try {
    return { designId, workspaceRoot: normalizeWorkspacePath(design.workspacePath) };
  } catch (cause) {
    throw new CodesignError('Stored workspace path is invalid', ERROR_CODES.WORKSPACE_MISSING, {
      cause,
    });
  }
}
