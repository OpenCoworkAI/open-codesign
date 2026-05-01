import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { resolveGenerationWorkspaceRoot } from './generation-workspace';
import {
  __unsafeSetDesignWorkspaceForTest,
  createDesign,
  initInMemoryDb,
  updateDesignWorkspace,
} from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';

describe('resolveGenerationWorkspaceRoot', () => {
  it('normalizes a valid stored workspace path before generation uses it', () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Bound design');
    const rawPath = `${path.join(tmpdir(), 'codesign-generation-workspace')}${path.sep}`;
    updateDesignWorkspace(db, design.id, rawPath);

    expect(resolveGenerationWorkspaceRoot(db, design.id)).toEqual({
      designId: design.id,
      workspaceRoot: normalizeWorkspacePath(rawPath),
    });
  });

  it('rejects missing, unbound, and corrupt workspace bindings before generation', () => {
    const db = initInMemoryDb();
    const unbound = createDesign(db, 'Unbound design');
    const corrupt = createDesign(db, 'Corrupt design');
    __unsafeSetDesignWorkspaceForTest(db, corrupt.id, '');

    expect(() => resolveGenerationWorkspaceRoot(null, unbound.id)).toThrow(CodesignError);
    expect(() => resolveGenerationWorkspaceRoot(db, undefined)).toThrow(CodesignError);
    expect(() => resolveGenerationWorkspaceRoot(db, 'missing')).toThrow(CodesignError);
    expect(() => resolveGenerationWorkspaceRoot(db, unbound.id)).toThrow(CodesignError);
    expect(() => resolveGenerationWorkspaceRoot(db, corrupt.id)).toThrow(
      'Stored workspace path is invalid',
    );
  });
});
