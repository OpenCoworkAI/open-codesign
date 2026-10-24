import { planSourceEdit } from '../../apps/desktop/src/main/source-edit-engine';

type Request = Parameters<typeof planSourceEdit>[0];
type Operation = Request['operation'];

export interface SelectionGrant {
  path: string;
  sourceHash: string;
  targetIds: readonly string[];
  fields: readonly string[];
}

export function fieldKey(operation: Operation): string {
  switch (operation.kind) {
    case 'set-text':
      return `text:${operation.textId ?? 'only'}`;
    case 'set-attribute':
      return `attribute:${operation.name}`;
    case 'set-style':
      return `style:${operation.property}`;
  }
}

/** The host must mint this grant from a confirmed selection, never from model arguments. */
export function planScopedEdit(grant: SelectionGrant, request: Request) {
  const reason =
    grant.path !== request.path
      ? 'outside-selected-file'
      : grant.sourceHash !== request.expectedSourceHash
        ? 'stale-selection'
        : !grant.targetIds.includes(request.targetId)
          ? 'outside-selection'
          : !grant.fields.includes(fieldKey(request.operation))
            ? 'field-not-authorized'
            : undefined;
  if (reason) return { schemaVersion: 1 as const, status: 'rejected' as const, reason };
  return planSourceEdit(request);
}
