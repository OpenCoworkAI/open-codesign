import {
  type SourceEditApplyBatchRequestV1,
  type SourceEditApplyRequestV1,
  SourceEditApplyResultV1,
  type SourceEditHistoryRequestV1,
  type SourceEditInspectRequestV1,
  SourceEditInspectResultV1,
} from '@open-codesign/shared';

export async function inspectWorkspaceSourceEdit(
  request: SourceEditInspectRequestV1,
  inspect: (request: SourceEditInspectRequestV1) => Promise<SourceEditInspectResultV1>,
): Promise<SourceEditInspectResultV1> {
  const result = SourceEditInspectResultV1.parse(await inspect(request));
  if (result.status === 'ready' && result.path !== request.path) {
    throw new Error('Source edit inspection returned a different source path.');
  }
  return result;
}

export async function persistWorkspaceSourceEdit(
  request: SourceEditApplyRequestV1,
  apply: (request: SourceEditApplyRequestV1) => Promise<SourceEditApplyResultV1>,
): Promise<SourceEditApplyResultV1> {
  return checkApplyAck(request, SourceEditApplyResultV1.parse(await apply(request)));
}

export async function persistWorkspaceSourceEditBatch(
  request: SourceEditApplyBatchRequestV1,
  applyBatch: (request: SourceEditApplyBatchRequestV1) => Promise<SourceEditApplyResultV1>,
): Promise<SourceEditApplyResultV1> {
  return checkApplyAck(request, SourceEditApplyResultV1.parse(await applyBatch(request)));
}

export async function undoWorkspaceSourceEdit(
  request: SourceEditHistoryRequestV1,
  undo: (request: SourceEditHistoryRequestV1) => Promise<SourceEditApplyResultV1>,
): Promise<SourceEditApplyResultV1> {
  return checkApplyAck(request, SourceEditApplyResultV1.parse(await undo(request)));
}

export async function redoWorkspaceSourceEdit(
  request: SourceEditHistoryRequestV1,
  redo: (request: SourceEditHistoryRequestV1) => Promise<SourceEditApplyResultV1>,
): Promise<SourceEditApplyResultV1> {
  return checkApplyAck(request, SourceEditApplyResultV1.parse(await redo(request)));
}

function checkApplyAck(
  request: { path: string; previewRevision: string },
  result: SourceEditApplyResultV1,
): SourceEditApplyResultV1 {
  if (result.status === 'applied' && result.path !== request.path) {
    throw new Error('Source edit save returned a different source path.');
  }
  if (result.status === 'applied' && result.previewRevision !== request.previewRevision) {
    throw new Error('Source edit save acknowledgement does not match the preview revision.');
  }
  return result;
}
