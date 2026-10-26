import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeSourceEdit, planSourceEdit } from '../../apps/desktop/src/main/source-edit-engine';
import { SourceEditOperation } from '../../packages/shared/src/source-edits';
import { planScopedEdit, type SelectionGrant } from './scoped-edit';

export const digest = (source: string) => createHash('sha256').update(source).digest('hex');
export const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'expectedSourceHash', 'targetId', 'kind', 'field', 'value'],
  properties: {
    path: { type: 'string' },
    expectedSourceHash: { type: 'string' },
    targetId: { type: 'string' },
    kind: { type: 'string', enum: ['set-text', 'set-style', 'set-attribute'] },
    field: { type: 'string' },
    value: { type: 'string' },
  },
};

export function decodeProposal(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  const keys = ['path', 'expectedSourceHash', 'targetId', 'kind', 'field', 'value'];
  if (Object.keys(p).length !== keys.length || keys.some((key) => typeof p[key] !== 'string'))
    return null;
  if (p.kind === 'set-text' && p.field !== 'text') return null;
  const operation = SourceEditOperation.safeParse(
    p.kind === 'set-text'
      ? { kind: p.kind, value: p.value }
      : p.kind === 'set-style'
        ? { kind: p.kind, property: p.field, value: p.value }
        : { kind: p.kind, name: p.field, value: p.value },
  );
  if (!operation.success) return null;
  return {
    path: p.path as string,
    expectedSourceHash: p.expectedSourceHash as string,
    targetId: p.targetId as string,
    operation: operation.data,
    scope: 'source-definition' as const,
  };
}

/** Research harness for newly created, single-writer directories. Not a desktop security boundary. */
export function executeFile(
  root: string,
  grant: SelectionGrant,
  proposal: unknown,
  guarded: boolean,
  beforeCommit?: () => void,
) {
  const request = decodeProposal(proposal);
  const reject = (reason: string) => ({ status: 'rejected' as const, reason, wrote: false });
  if (!request) return reject('invalid-response');
  // A fixed host inventory also bounds the unguarded comparator; model paths never become arbitrary IO.
  if (!['App.jsx', 'Archive.jsx'].includes(request.path)) return reject('unknown-file');
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
    return reject('invalid-root');
  const rootPath = realpathSync(root);
  const file = path.join(rootPath, request.path);
  if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) return reject('invalid-file');
  const source = readFileSync(file, 'utf8');
  const result = guarded
    ? planScopedEdit(grant, { ...request, source })
    : planSourceEdit({ ...request, source });
  if (result.status !== 'applied') return reject(result.reason);
  if (analyzeSourceEdit({ path: request.path, source: result.content }).status !== 'ready')
    return reject('invalid-result');
  beforeCommit?.();
  if (lstatSync(file).isSymbolicLink() || readFileSync(file, 'utf8') !== source)
    return reject('source-changed-before-write');
  const temporary = path.join(rootPath, `.edit-${randomUUID()}.tmp`);
  writeFileSync(temporary, result.content, { flag: 'wx' });
  // Atomic replacement avoids partial writes. No filesystem CAS: an uncooperative external writer
  // between the last read and rename is not excluded. Production requires host transaction ownership.
  renameSync(temporary, file);
  return {
    status: 'applied' as const,
    reason: null,
    wrote: true,
    beforeHash: digest(source),
    afterHash: digest(readFileSync(file, 'utf8')),
    patch: result.patch,
  };
}
