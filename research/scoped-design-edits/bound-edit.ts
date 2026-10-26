import { randomUUID } from 'node:crypto';
import { executeFile } from './file-executor';
import type { SelectionGrant } from './scoped-edit';

/** Captures a host-confirmed selection. Never rebase this handle onto a newer file revision. */
export function createBoundEdit(root: string, selection: SelectionGrant) {
  if (selection.targetIds.length !== 1) throw new Error('One confirmed source target required');
  const grant = structuredClone(selection);
  const handle = randomUUID();
  let consumed = false;
  return {
    publicBinding: { handle, fields: [...grant.fields] },
    execute(value: unknown) {
      const reject = (reason: string) => ({ status: 'rejected' as const, reason, wrote: false });
      if (consumed) return reject('consumed-selection');
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return reject('invalid-bound-proposal');
      const p = value as Record<string, unknown>;
      const keys = ['handle', 'kind', 'field', 'value'];
      if (Object.keys(p).length !== keys.length || keys.some((key) => typeof p[key] !== 'string'))
        return reject('invalid-bound-proposal');
      if (p.handle !== handle) return reject('unknown-selection');
      consumed = true;
      // Path, AST identity and expected revision are supplied by the trusted snapshot, not the model.
      return executeFile(
        root,
        grant,
        {
          path: grant.path,
          targetId: grant.targetIds[0],
          expectedSourceHash: grant.sourceHash,
          kind: p.kind,
          field: p.field,
          value: p.value,
        },
        true,
      );
    },
  };
}
