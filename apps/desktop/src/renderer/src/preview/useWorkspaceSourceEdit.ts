import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import {
  type SourceEditOperation,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SourceEditAncestor,
  type SourceEditValidationRequest,
  sourceEditFieldState,
} from './helpers';
import { sourceEditReasonMessage } from './source-edit-messages';
import {
  inspectWorkspaceSourceEdit,
  persistWorkspaceSourceEdit,
  persistWorkspaceSourceEditBatch,
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
  // Survives the reload a save causes, so the same element can be re-pinned.
  const restoreSelector = useRef<string | null>(null);
  const allowed =
    input.available &&
    !input.generating &&
    Boolean(input.designId) &&
    input.source?.workspaceDesignId === input.designId &&
    /\.(jsx|tsx)$/i.test(input.source?.path ?? '') &&
    Boolean(window.codesign?.sourceEdits);
  const eligible = allowed && !input.loading;
  const context = useMemo(
    () => ({
      designId: input.designId,
      selectedPath: input.selectedPath,
      path: input.source?.path,
      content: input.source?.content,
      eligible,
      allowed,
      enabled,
      refresh,
    }),
    [
      input.designId,
      input.selectedPath,
      input.source?.path,
      input.source?.content,
      eligible,
      allowed,
      enabled,
      refresh,
    ],
  );
  const current = useRef(context);
  current.current = context;
  const epoch = useRef(0);
  const selectionEpoch = useRef(0);
  const applying = useRef(false);
  const validation = useRef<AbortController | null>(null);
  const [inspected, setInspected] = useState<{
    context: typeof context;
    source: string;
    sourceHash: string;
    previewRevision: string;
    targets: SourceEditTarget[];
  } | null>(null);
  const active = enabled && allowed;
  const inspection = active && inspected?.context === context ? inspected : null;

  useEffect(() => {
    const ticket = ++epoch.current;
    validation.current?.abort();
    applying.current = false;
    selectionEpoch.current++;
    setSelection(null);
    setFieldStates(undefined);
    setAncestors([]);
    setPicked(null);
    setInspected(null);
    setMessage(null);
    setBusy(false);
    if (!context.allowed) setEnabled(false);
    if (!context.enabled || !context.allowed) restoreSelector.current = null;
    if (
      !context.enabled ||
      !context.eligible ||
      !context.designId ||
      !context.path ||
      context.content === undefined
    )
      return;
    const api = window.codesign?.sourceEdits;
    if (!api) {
      setMessage(t('canvas.sourceEdit.unavailable'));
      return;
    }
    setBusy(true);
    void inspectWorkspaceSourceEdit(
      {
        schemaVersion: 1,
        designId: context.designId,
        path: context.path,
        expectedContent: context.content,
      },
      api.inspect,
    )
      .then((result) => {
        if (current.current !== context || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(sourceEditReasonMessage(result.reason, t));
          return;
        }
        setInspected({
          context,
          source: context.content ?? '',
          sourceHash: result.sourceHash,
          previewRevision: crypto.randomUUID(),
          targets: result.targets,
        });
      })
      .catch(() => {
        if (current.current === context && epoch.current === ticket)
          setMessage(t('canvas.sourceEdit.inspectFailed'));
      })
      .finally(() => {
        if (current.current === context && epoch.current === ticket) setBusy(false);
      });
    return () => {
      epoch.current++;
      validation.current?.abort();
    };
  }, [context, t]);

  const clearSelection = useCallback(() => {
    selectionEpoch.current++;
    validation.current?.abort();
    setSelection(null);
    setFieldStates(undefined);
    setAncestors([]);
    setPicked(null);
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
      if (!active || !inspection || applying.current) return;
      selectionEpoch.current++;
      setMessage(null);
      const matches =
        meta?.sourceHash === inspection.sourceHash &&
        meta.previewRevision === inspection.previewRevision;
      const target = matches
        ? inspection.targets.find((item) => item.id === meta.targetId)
        : undefined;
      setSelection(target ?? null);
      setFieldStates(target ? meta?.fieldStates : undefined);
      setAncestors(!meta || matches ? trail : []);
      setPicked(element ?? null);
      if (!target) setMessage(t('canvas.sourceEdit.unsupportedSelection'));
    },
    [active, inspection, t],
  );

  const apply = useCallback(
    async (request: SourceEditOperation | SourceEditOperation[]) => {
      const operations = Array.isArray(request) ? request : [request];
      const operation = operations[0];
      if (
        !operation ||
        !inspection ||
        !selection ||
        !context.designId ||
        !context.path ||
        applying.current ||
        current.current !== context
      )
        return;
      const fieldKey = sourceEditFieldKey(operation);
      const editable = (op: SourceEditOperation, states: SourceEditSelection['fieldStates']) =>
        selection.editableFields.some(
          (field) => sourceEditFieldKey(field) === sourceEditFieldKey(op),
        ) && sourceEditFieldState(selection, op, states).status === 'ready';
      if (!operations.every((op) => editable(op, fieldStates))) {
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
            fieldKey,
          },
          controller.signal,
        );
        if (
          current.current !== context ||
          epoch.current !== ticket ||
          selectionEpoch.current !== selectedTicket ||
          controller.signal.aborted
        )
          return;
        const valid =
          checked?.targetId === selection.id &&
          checked.sourceHash === inspection.sourceHash &&
          checked.previewRevision === inspection.previewRevision;
        if (!valid || !operations.every((op) => editable(op, checked?.fieldStates))) {
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
          designId: context.designId,
          path: context.path,
          expectedSourceHash: inspection.sourceHash,
          previewRevision: inspection.previewRevision,
          targetId: selection.id,
          scope: 'source-definition' as const,
        };
        const result =
          operations.length > 1 && api.applyBatch
            ? await persistWorkspaceSourceEditBatch({ ...base, operations }, api.applyBatch)
            : await persistWorkspaceSourceEdit({ ...base, operation }, api.apply);
        if (current.current !== context || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(sourceEditReasonMessage(result.reason, t));
          return;
        }
        restoreSelector.current = picked?.selector ?? null;
        clearSelection();
        setInspected(null);
        setRefresh((value) => value + 1);
        input.onPersist({
          path: result.path,
          content: result.content,
          workspaceDesignId: context.designId,
        });
        // Only the atomic-write ACK may announce a save, never an optimistic local patch.
        input.onSaved(result.warnings?.length ? [t('canvas.sourceEdit.refreshWarning')] : []);
      } catch {
        if (current.current === context && epoch.current === ticket && !controller.signal.aborted)
          setMessage(t('canvas.sourceEdit.saveFailed'));
      } finally {
        if (validation.current === controller) validation.current = null;
        if (current.current === context && epoch.current === ticket) {
          applying.current = false;
          setBusy(false);
        }
      }
    },
    [
      context,
      inspection,
      selection,
      fieldStates,
      picked,
      input.validate,
      input.onPersist,
      input.onSaved,
      clearSelection,
      t,
    ],
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
    selection: inspection ? selection : null,
    fieldStates: inspection ? fieldStates : undefined,
    ancestors: inspection ? ancestors : [],
    picked: inspection ? picked : null,
    toggle: () => {
      setEnabled((value) => !value);
      restoreSelector.current = null;
      clearSelection();
    },
    enable,
    clearSelection,
    exit,
    select,
    apply,
    takeRestoreSelector,
  };
}
