import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import {
  type SourceEditApplyResultV1,
  type SourceEditElementSnapshot,
  type SourceEditHistoryRequestV1,
  type SourceEditMapItemBinding,
  type SourceEditOperation,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SourceEditAncestor,
  type SourceEditInlineEditRequest,
  type SourceEditValidationRequest,
  sourceEditFieldState,
} from './helpers';
import { sourceEditReasonMessage } from './source-edit-messages';
import {
  inspectWorkspaceSourceEdit,
  persistWorkspaceSourceEdit,
  persistWorkspaceSourceEditBatch,
  redoWorkspaceSourceEdit,
  undoWorkspaceSourceEdit,
} from './source-edit-persistence';

export interface SourceEditWorkspaceSource {
  path: string;
  content: string;
  workspaceDesignId?: string;
}

/** The clicked preview element, independent of whether it maps to editable source. */
export interface SourceEditPickedElement {
  selector: string;
  tag: string;
  outerHTML: string;
  rect: { top: number; left: number; width: number; height: number };
  parentOuterHTML?: string;
  elementSnapshot?: SourceEditElementSnapshot;
}

export interface WorkspaceSourceEditInspection {
  designId: string;
  selectedPath: string;
  path: string;
  source: string;
  propContent: string;
  refresh: number;
  sourceHash: string;
  previewRevision: string;
  targets: SourceEditTarget[];
  mapItemBindings: SourceEditMapItemBinding[];
  canUndo: boolean;
  canRedo: boolean;
}

type SourceEditsApiWithHistory = NonNullable<NonNullable<Window['codesign']>['sourceEdits']> & {
  undo?: (input: SourceEditHistoryRequestV1) => Promise<SourceEditApplyResultV1>;
  redo?: (input: SourceEditHistoryRequestV1) => Promise<SourceEditApplyResultV1>;
};

function isOperationEditable(
  target: SourceEditTarget,
  op: SourceEditOperation,
  states: SourceEditSelection['fieldStates'],
): boolean {
  const inEditableFields = target.editableFields.some(
    (field) => sourceEditFieldKey(field) === sourceEditFieldKey(op),
  );
  switch (op.kind) {
    case 'set-text':
      return inEditableFields && sourceEditFieldState(target, op, states).status === 'ready';
    case 'set-style': {
      if (inEditableFields) {
        return sourceEditFieldState(target, op, states).status === 'ready';
      }
      const binding = target.styleBindings?.find((item) => item.property === op.property);
      if (binding && !binding.editable) return false;
      return Boolean(target.capabilities?.canUpsertStyle);
    }
    case 'remove-style':
      return Boolean(target.capabilities?.canUpsertStyle);
    case 'set-attribute':
      if (inEditableFields) {
        return sourceEditFieldState(target, op, states).status === 'ready';
      }
      return Boolean(target.capabilities?.canUpsertAttribute);
    case 'remove-attribute':
      return Boolean(target.capabilities?.canUpsertAttribute);
    case 'set-class-name':
      return Boolean(target.capabilities?.canEditClassName);
    case 'toggle-visibility':
      return Boolean(
        target.capabilities &&
          (target.capabilities.canUpsertStyle ||
            target.capabilities.canEditClassName ||
            target.capabilities.canUpsertAttribute),
      );
    case 'reorder-sibling': {
      const capOk =
        op.direction === 'up'
          ? Boolean(target.capabilities?.canReorderUp)
          : Boolean(target.capabilities?.canReorderDown);
      if (!capOk) return false;
      if (op.itemIndex !== undefined && target.mapSource) {
        return op.direction === 'up'
          ? op.itemIndex > 0
          : op.itemIndex + 1 < target.mapSource.itemCount;
      }
      return true;
    }
    case 'duplicate-element':
      return Boolean(target.capabilities?.canDuplicate);
    case 'delete-element':
      return Boolean(target.capabilities?.canDelete);
    case 'set-map-item-text':
      return Boolean(
        target.mapSource &&
          op.itemIndex >= 0 &&
          op.itemIndex < target.mapSource.itemCount &&
          target.mapSource.fields.some((field) => field.key === op.fieldKey),
      );
  }
}

function restoreSelectorForOperations(
  operations: readonly SourceEditOperation[],
  selector: string | null,
): string | null {
  if (!selector) return null;
  if (operations.some((op) => op.kind === 'delete-element')) return null;
  if (operations.some((op) => op.kind === 'reorder-sibling') && selector.startsWith('/')) {
    return null;
  }
  return selector;
}

export function useWorkspaceSourceEdit(input: {
  designId: string | null;
  selectedPath: string;
  source: SourceEditWorkspaceSource | null;
  available: boolean;
  loading?: boolean;
  generating: boolean;
  validate: (
    request: SourceEditValidationRequest,
    signal: AbortSignal,
  ) => Promise<SourceEditSelection | null>;
  onAfterCommit?: (
    nextInspect: WorkspaceSourceEditInspection,
    restoreSelector: string | null,
    signal: AbortSignal,
  ) => Promise<boolean>;
  onPersist: (source: SourceEditWorkspaceSource) => void;
  onSaved: (warnings: string[]) => void;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<SourceEditTarget | null>(null);
  const [fieldStates, setFieldStates] = useState<SourceEditSelection['fieldStates']>();
  const [ancestors, setAncestors] = useState<SourceEditAncestor[]>([]);
  const [picked, setPicked] = useState<SourceEditPickedElement | null>(null);
  const [inlineEditRequest, setInlineEditRequest] = useState<SourceEditInlineEditRequest | null>(
    null,
  );
  // Survives the reload a save causes, so the same element can be re-pinned.
  const restoreSelector = useRef<string | null>(null);
  const allowed =
    input.available &&
    !input.generating &&
    Boolean(input.designId) &&
    input.source?.workspaceDesignId === input.designId &&
    /\.(jsx|tsx|html|htm)$/i.test(input.source?.path ?? '') &&
    Boolean(window.codesign?.sourceEdits);
  const eligible = allowed && !input.loading;
  const inspectKey = useMemo(
    () => ({
      designId: input.designId,
      selectedPath: input.selectedPath,
      path: input.source?.path,
      content: input.source?.content,
      allowed,
      enabled,
      refresh,
    }),
    [
      input.designId,
      input.selectedPath,
      input.source?.path,
      input.source?.content,
      allowed,
      enabled,
      refresh,
    ],
  );
  const current = useRef(inspectKey);
  current.current = inspectKey;
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  const epoch = useRef(0);
  const selectionEpoch = useRef(0);
  const applying = useRef(false);
  const validation = useRef<AbortController | null>(null);
  const [inspected, setInspected] = useState<WorkspaceSourceEditInspection | null>(null);
  const inspectedRef = useRef<WorkspaceSourceEditInspection | null>(null);
  const pendingHotSwapRef = useRef<WorkspaceSourceEditInspection | null>(null);
  const [pendingInspection, setPendingInspection] = useState<WorkspaceSourceEditInspection | null>(
    null,
  );
  const selectionRevisionRef = useRef<string | null>(null);
  const active = enabled && allowed;
  const activeRef = useRef(active);
  activeRef.current = active;

  const updateInspected = useCallback((next: WorkspaceSourceEditInspection | null) => {
    inspectedRef.current = next;
    setInspected(next);
  }, []);

  const getExpectedRevisions = useCallback(() => {
    if (!activeRef.current) return undefined;
    const list = [inspectedRef.current, pendingHotSwapRef.current].filter(
      (item): item is WorkspaceSourceEditInspection => Boolean(item),
    );
    if (list.length === 0) return undefined;
    return list.length === 1 ? list[0] : list;
  }, []);

  const inspection =
    active &&
    inspected &&
    inspected.designId === inspectKey.designId &&
    inspected.selectedPath === inspectKey.selectedPath &&
    inspected.path === inspectKey.path &&
    inspected.refresh === inspectKey.refresh &&
    (inspected.source === inspectKey.content || inspected.propContent === inspectKey.content)
      ? inspected
      : null;

  const isSameInspectContext = useCallback(
    (a: typeof inspectKey, b: typeof inspectKey) =>
      a.designId === b.designId &&
      a.selectedPath === b.selectedPath &&
      a.path === b.path &&
      a.allowed === b.allowed &&
      a.enabled === b.enabled &&
      a.refresh === b.refresh,
    [],
  );

  useEffect(() => {
    const prev = inspectedRef.current;
    if (
      inspectKey.allowed &&
      inspectKey.enabled &&
      inspectKey.designId &&
      inspectKey.path &&
      inspectKey.content !== undefined &&
      prev &&
      prev.designId === inspectKey.designId &&
      prev.selectedPath === inspectKey.selectedPath &&
      prev.path === inspectKey.path &&
      prev.refresh === inspectKey.refresh &&
      (prev.source === inspectKey.content || prev.propContent === inspectKey.content)
    ) {
      // Content equality guard: watcher re-reads with identical bytes keep the live
      // previewRevision and selection intact without flickering or remounting.
      if (prev.source === inspectKey.content) {
        prev.propContent = inspectKey.content;
      }
      return;
    }

    const ticket = ++epoch.current;
    validation.current?.abort();
    applying.current = false;
    pendingHotSwapRef.current = null;
    setPendingInspection(null);
    selectionRevisionRef.current = null;
    selectionEpoch.current++;
    setSelection(null);
    setFieldStates(undefined);
    setAncestors([]);
    setPicked(null);
    setInlineEditRequest(null);
    updateInspected(null);
    setMessage(null);
    setBusy(false);
    if (!inspectKey.allowed) setEnabled(false);
    if (!inspectKey.enabled || !inspectKey.allowed) restoreSelector.current = null;
    if (
      !inspectKey.enabled ||
      !inspectKey.allowed ||
      !inspectKey.designId ||
      !inspectKey.path ||
      inspectKey.content === undefined
    ) {
      return;
    }
    const api = window.codesign?.sourceEdits;
    if (!api) {
      setMessage(t('canvas.sourceEdit.unavailable'));
      return;
    }
    const designId = inspectKey.designId;
    const path = inspectKey.path;
    const content = inspectKey.content;
    setBusy(true);
    void inspectWorkspaceSourceEdit(
      {
        schemaVersion: 1,
        designId,
        path,
        expectedContent: content,
      },
      api.inspect,
    )
      .then((result) => {
        if (current.current !== inspectKey || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(sourceEditReasonMessage(result.reason, t));
          return;
        }
        updateInspected({
          designId,
          selectedPath: inspectKey.selectedPath,
          path,
          source: content,
          propContent: content,
          refresh: inspectKey.refresh,
          sourceHash: result.sourceHash,
          previewRevision: crypto.randomUUID(),
          targets: result.targets,
          mapItemBindings: result.mapItemBindings ?? [],
          canUndo: result.canUndo ?? false,
          canRedo: result.canRedo ?? false,
        });
      })
      .catch(() => {
        if (current.current === inspectKey && epoch.current === ticket)
          setMessage(t('canvas.sourceEdit.inspectFailed'));
      })
      .finally(() => {
        if (current.current === inspectKey && epoch.current === ticket) setBusy(false);
      });
    return () => {
      epoch.current++;
      validation.current?.abort();
    };
  }, [inspectKey, t, updateInspected]);

  const clearInlineEdit = useCallback(() => {
    setInlineEditRequest(null);
  }, []);

  const clearSelection = useCallback(() => {
    selectionEpoch.current++;
    validation.current?.abort();
    setSelection(null);
    setFieldStates(undefined);
    setAncestors([]);
    setPicked(null);
    setInlineEditRequest(null);
  }, []);

  const exit = useCallback(() => {
    setEnabled(false);
    restoreSelector.current = null;
    clearSelection();
  }, [clearSelection]);

  const enable = useCallback(() => {
    setEnabled(true);
    clearSelection();
  }, [clearSelection]);

  const select = useCallback(
    (
      meta?: SourceEditSelection,
      trail: SourceEditAncestor[] = [],
      element?: SourceEditPickedElement,
    ) => {
      if (!active || !inspection) return;
      const pendingSwap = pendingHotSwapRef.current;
      const matchesPending =
        pendingSwap !== null &&
        meta?.sourceHash === pendingSwap.sourceHash &&
        meta.previewRevision === pendingSwap.previewRevision;
      if (applying.current && !matchesPending) return;

      selectionEpoch.current++;
      setMessage(null);
      setInlineEditRequest(null);
      const matchesCurrent =
        meta?.sourceHash === inspection.sourceHash &&
        meta.previewRevision === inspection.previewRevision;
      const matchedInspection = matchesPending ? pendingSwap : matchesCurrent ? inspection : null;
      const target =
        matchedInspection && meta
          ? matchedInspection.targets.find((item) => item.id === meta.targetId)
          : undefined;
      if (matchesPending && pendingSwap) {
        selectionRevisionRef.current = pendingSwap.previewRevision;
      } else {
        selectionRevisionRef.current = target ? inspection.previewRevision : null;
      }
      setSelection(target ?? null);
      setFieldStates(target ? meta?.fieldStates : undefined);
      setAncestors(!meta || matchedInspection ? trail : []);
      setPicked(element ?? null);
      if (!target) setMessage(t('canvas.sourceEdit.unsupportedSelection'));
    },
    [active, inspection, t],
  );

  const openInlineEdit = useCallback(
    (request: SourceEditInlineEditRequest) => {
      if (!active || !inspection || applying.current) return;
      if (
        request.sourceHash !== inspection.sourceHash ||
        request.previewRevision !== inspection.previewRevision
      ) {
        return;
      }
      const target = inspection.targets.find((item) => item.id === request.targetId);
      if (!target) return;
      setInlineEditRequest(request);
    },
    [active, inspection],
  );

  const commitAppliedResult = useCallback(
    async (
      result: Extract<SourceEditApplyResultV1, { status: 'applied' }>,
      restoreTargetSelector: string | null,
      controller: AbortController,
      ticket: number,
    ) => {
      const api = window.codesign?.sourceEdits;
      if (!api || !inspectKey.designId || !inspectKey.path) return;
      const designId = inspectKey.designId;
      const path = inspectKey.path;
      let nextInspectResult: Awaited<ReturnType<typeof inspectWorkspaceSourceEdit>> | null = null;
      try {
        nextInspectResult = await inspectWorkspaceSourceEdit(
          {
            schemaVersion: 1,
            designId,
            path,
            expectedContent: result.content,
          },
          api.inspect,
        );
      } catch {
        nextInspectResult = null;
      }
      if (current.current !== inspectKey || epoch.current !== ticket || controller.signal.aborted) {
        return;
      }
      if (!nextInspectResult || nextInspectResult.status === 'rejected') {
        restoreSelector.current = restoreTargetSelector;
        clearSelection();
        updateInspected(null);
        setRefresh((value) => value + 1);
        input.onPersist({
          path: result.path,
          content: result.content,
          workspaceDesignId: designId,
        });
        input.onSaved(result.warnings?.length ? [t('canvas.sourceEdit.refreshWarning')] : []);
        return;
      }

      const nextInspection: WorkspaceSourceEditInspection = {
        designId,
        selectedPath: inspectKey.selectedPath,
        path: result.path,
        source: result.content,
        propContent: inspectKey.content ?? result.content,
        refresh: inspectKey.refresh,
        sourceHash: nextInspectResult.sourceHash,
        previewRevision: crypto.randomUUID(),
        targets: nextInspectResult.targets,
        mapItemBindings: nextInspectResult.mapItemBindings ?? [],
        canUndo: nextInspectResult.canUndo ?? result.canUndo ?? false,
        canRedo: nextInspectResult.canRedo ?? result.canRedo ?? false,
      };

      let hotSwapped = false;
      if (input.onAfterCommit) {
        pendingHotSwapRef.current = nextInspection;
        setPendingInspection(nextInspection);
        selectionRevisionRef.current = null;
        try {
          hotSwapped = await input.onAfterCommit(
            nextInspection,
            restoreTargetSelector,
            controller.signal,
          );
        } catch {
          hotSwapped = false;
        } finally {
          pendingHotSwapRef.current = null;
          setPendingInspection(null);
        }
      }
      if (current.current !== inspectKey || epoch.current !== ticket || controller.signal.aborted) {
        return;
      }

      if (hotSwapped) {
        restoreSelector.current = null;
        if (selectionRevisionRef.current !== nextInspection.previewRevision) {
          clearSelection();
        }
        updateInspected(nextInspection);
      } else {
        restoreSelector.current = restoreTargetSelector;
        clearSelection();
        updateInspected(nextInspection);
      }
      // Clear busy/applying and detach the validation controller BEFORE onPersist
      // triggers the content-equality effect re-render so cleanup cannot abort or strand busy=true.
      if (validation.current === controller) validation.current = null;
      applying.current = false;
      setBusy(false);
      input.onPersist({
        path: result.path,
        content: result.content,
        workspaceDesignId: designId,
      });
      // Only the atomic-write ACK may announce a save, never an optimistic local patch.
      input.onSaved(result.warnings?.length ? [t('canvas.sourceEdit.refreshWarning')] : []);
    },
    [inspectKey, input, clearSelection, updateInspected, t],
  );

  const apply = useCallback(
    async (request: SourceEditOperation | SourceEditOperation[]) => {
      const operations = Array.isArray(request) ? request : [request];
      const operation = operations[0];
      if (
        !operation ||
        !inspection ||
        !selection ||
        !eligibleRef.current ||
        !inspectKey.designId ||
        !inspectKey.path ||
        applying.current ||
        current.current !== inspectKey
      )
        return;
      const fieldKey = sourceEditFieldKey(operation);
      if (!operations.every((op) => isOperationEditable(selection, op, fieldStates))) {
        setMessage(t('canvas.sourceEdit.validationFailed'));
        return;
      }
      const api = window.codesign?.sourceEdits;
      if (!api || (operations.length > 1 && !api.applyBatch)) {
        setMessage(t('canvas.sourceEdit.unavailable'));
        return;
      }
      applying.current = true;
      const ticket = epoch.current;
      const selectedTicket = selectionEpoch.current;
      const controller = new AbortController();
      validation.current = controller;
      setBusy(true);
      setMessage(null);
      try {
        const checked = await input.validate(
          {
            targetId: selection.id,
            sourceHash: inspection.sourceHash,
            previewRevision: inspection.previewRevision,
            fieldKey: fieldKey.slice(0, 99),
          },
          controller.signal,
        );
        if (
          current.current !== inspectKey ||
          epoch.current !== ticket ||
          selectionEpoch.current !== selectedTicket ||
          controller.signal.aborted
        )
          return;
        const valid =
          checked?.targetId === selection.id &&
          checked.sourceHash === inspection.sourceHash &&
          checked.previewRevision === inspection.previewRevision;
        if (
          !valid ||
          !operations.every((op) => isOperationEditable(selection, op, checked?.fieldStates))
        ) {
          setFieldStates(
            valid
              ? checked?.fieldStates
              : selection.editableFields.map((field) => ({
                  key: sourceEditFieldKey(field),
                  status: 'unmapped' as const,
                })),
          );
          setMessage(t('canvas.sourceEdit.validationFailed'));
          return;
        }
        setFieldStates(checked.fieldStates);
        const base = {
          schemaVersion: 1 as const,
          designId: inspectKey.designId,
          path: inspectKey.path,
          expectedSourceHash: inspection.sourceHash,
          previewRevision: inspection.previewRevision,
          targetId: selection.id,
          scope: 'source-definition' as const,
        };
        const result =
          operations.length > 1 && api.applyBatch
            ? await persistWorkspaceSourceEditBatch({ ...base, operations }, api.applyBatch)
            : await persistWorkspaceSourceEdit({ ...base, operation }, api.apply);
        if (current.current !== inspectKey || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(sourceEditReasonMessage(result.reason, t));
          return;
        }
        const restoreTarget = restoreSelectorForOperations(operations, picked?.selector ?? null);
        await commitAppliedResult(result, restoreTarget, controller, ticket);
      } catch {
        if (
          current.current === inspectKey &&
          epoch.current === ticket &&
          !controller.signal.aborted
        )
          setMessage(t('canvas.sourceEdit.saveFailed'));
      } finally {
        if (validation.current === controller) validation.current = null;
        if (isSameInspectContext(current.current, inspectKey) && !controller.signal.aborted) {
          applying.current = false;
          setBusy(false);
        }
      }
    },
    [
      inspectKey,
      isSameInspectContext,
      inspection,
      selection,
      fieldStates,
      picked,
      input.validate,
      commitAppliedResult,
      t,
    ],
  );

  const runHistory = useCallback(
    async (kind: 'undo' | 'redo') => {
      if (
        !inspection ||
        !eligibleRef.current ||
        !inspectKey.designId ||
        !inspectKey.path ||
        applying.current ||
        current.current !== inspectKey
      ) {
        return;
      }
      if (kind === 'undo' && !inspection.canUndo) return;
      if (kind === 'redo' && !inspection.canRedo) return;
      const api = window.codesign?.sourceEdits as SourceEditsApiWithHistory | undefined;
      const fn = kind === 'undo' ? api?.undo : api?.redo;
      if (!api || typeof fn !== 'function') {
        setMessage(t('canvas.sourceEdit.unavailable'));
        return;
      }
      applying.current = true;
      const ticket = epoch.current;
      const controller = new AbortController();
      validation.current = controller;
      setBusy(true);
      setMessage(null);
      setInlineEditRequest(null);
      try {
        const request: SourceEditHistoryRequestV1 = {
          schemaVersion: 1,
          designId: inspectKey.designId,
          path: inspectKey.path,
          expectedSourceHash: inspection.sourceHash,
          previewRevision: inspection.previewRevision,
        };
        const result =
          kind === 'undo'
            ? await undoWorkspaceSourceEdit(request, fn)
            : await redoWorkspaceSourceEdit(request, fn);
        if (current.current !== inspectKey || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(sourceEditReasonMessage(result.reason, t));
          return;
        }
        await commitAppliedResult(result, picked?.selector ?? null, controller, ticket);
      } catch {
        if (
          current.current === inspectKey &&
          epoch.current === ticket &&
          !controller.signal.aborted
        ) {
          setMessage(t('canvas.sourceEdit.saveFailed'));
        }
      } finally {
        if (validation.current === controller) validation.current = null;
        if (isSameInspectContext(current.current, inspectKey) && !controller.signal.aborted) {
          applying.current = false;
          setBusy(false);
        }
      }
    },
    [inspectKey, isSameInspectContext, inspection, picked, commitAppliedResult, t],
  );

  const undo = useCallback(() => runHistory('undo'), [runHistory]);
  const redo = useCallback(() => runHistory('redo'), [runHistory]);

  const applyQuickAction = useCallback(
    async (operation: SourceEditOperation) => {
      setInlineEditRequest(null);
      await apply(operation);
    },
    [apply],
  );

  const takeRestoreSelector = useCallback((): string | null => {
    if (!inspection) return null;
    const selector = restoreSelector.current;
    restoreSelector.current = null;
    return selector;
  }, [inspection]);

  return {
    active,
    eligible,
    busy,
    message,
    inspection,
    pendingInspection: active ? pendingInspection : null,
    getExpectedRevisions,
    mapItemBindings: inspection ? inspection.mapItemBindings : [],
    canUndo: Boolean(inspection?.canUndo),
    canRedo: Boolean(inspection?.canRedo),
    selection: inspection ? selection : null,
    fieldStates: inspection ? fieldStates : undefined,
    ancestors: inspection ? ancestors : [],
    picked: inspection ? picked : null,
    elementSnapshot: inspection ? (picked?.elementSnapshot ?? null) : null,
    inlineEditRequest: inspection ? inlineEditRequest : null,
    toggle: () => {
      setEnabled((value) => !value);
      restoreSelector.current = null;
      clearSelection();
    },
    enable,
    clearSelection,
    exit,
    select,
    openInlineEdit,
    clearInlineEdit,
    apply,
    applyQuickAction,
    undo,
    redo,
    takeRestoreSelector,
  };
}
