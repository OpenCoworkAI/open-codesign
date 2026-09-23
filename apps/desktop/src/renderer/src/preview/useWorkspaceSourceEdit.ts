import { useT } from '@open-codesign/i18n';
import type { SourceEditSelection } from '@open-codesign/runtime';
import type { SourceEditOperation, SourceEditTarget } from '@open-codesign/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inspectWorkspaceSourceEdit, persistWorkspaceSourceEdit } from './source-edit-persistence';

export interface SourceEditWorkspaceSource {
  path: string;
  content: string;
  workspaceDesignId?: string;
}

export function useWorkspaceSourceEdit(input: {
  designId: string | null;
  selectedPath: string;
  source: SourceEditWorkspaceSource | null;
  available: boolean;
  loading?: boolean;
  generating: boolean;
  onPersist: (source: SourceEditWorkspaceSource) => void;
  onSaved: (warnings: string[]) => void;
}) {
  const t = useT();
  const [sourceMode, setSourceMode] = useState(false);
  const [canSelectSource, setCanSelectSource] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<SourceEditTarget | null>(null);
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
      sourceMode,
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
      sourceMode,
    ],
  );
  const current = useRef(context);
  current.current = context;
  const epoch = useRef(0);
  const applying = useRef(false);
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
    applying.current = false;
    setSelection(null);
    setInspected(null);
    setMessage(null);
    setCanSelectSource(false);
    setBusy(false);
    if (!context.allowed) setEnabled(false);
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
        ...(context.sourceMode ? { selectionMode: 'source' as const } : {}),
      },
      api.inspect,
    )
      .then((result) => {
        if (current.current !== context || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setCanSelectSource(
            !context.sourceMode &&
              ['unsafe-source', 'reused-entry', 'cross-file-source'].includes(result.reason),
          );
          setMessage(`${result.message} (${result.reason})`);
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
      .catch((error: unknown) => {
        if (current.current === context && epoch.current === ticket) {
          setMessage(error instanceof Error ? error.message : t('errors.unknown'));
        }
      })
      .finally(() => {
        if (current.current === context && epoch.current === ticket) setBusy(false);
      });
    return () => {
      epoch.current++;
    };
  }, [context, t]);

  const select = useCallback(
    (meta?: SourceEditSelection) => {
      if (!active || sourceMode || applying.current) return;
      setMessage(null);
      const target =
        inspection &&
        meta &&
        meta.sourceHash === inspection.sourceHash &&
        meta.previewRevision === inspection.previewRevision
          ? inspection.targets.find((item) => item.id === meta.targetId)
          : undefined;
      setSelection(target ?? null);
      if (!target) setMessage(t('canvas.sourceEdit.unsupportedSelection'));
    },
    [active, inspection, sourceMode, t],
  );

  const apply = useCallback(
    async (operation: SourceEditOperation) => {
      if (
        !inspection ||
        !selection ||
        !context.designId ||
        !context.path ||
        applying.current ||
        current.current !== context
      )
        return;
      const api = window.codesign?.sourceEdits;
      if (!api) {
        setMessage(t('canvas.sourceEdit.unavailable'));
        return;
      }
      applying.current = true;
      const ticket = epoch.current;
      setBusy(true);
      setMessage(null);
      try {
        const result = await persistWorkspaceSourceEdit(
          {
            schemaVersion: 1,
            designId: context.designId,
            path: context.path,
            expectedSourceHash: inspection.sourceHash,
            previewRevision: inspection.previewRevision,
            targetId: selection.id,
            operation,
            scope: 'source-definition',
            ...(context.sourceMode ? { selectionMode: 'source' as const } : {}),
          },
          api.apply,
        );
        if (current.current !== context || epoch.current !== ticket) return;
        if (result.status === 'rejected') {
          setMessage(`${result.message} (${result.reason})`);
          return;
        }
        setSelection(null);
        setInspected(null);
        setRefresh((value) => value + 1);
        input.onPersist({
          path: result.path,
          content: result.content,
          workspaceDesignId: context.designId,
        });
        // Only the atomic-write ACK may announce a save, never an optimistic local patch.
        input.onSaved(result.warnings ?? []);
      } catch (error) {
        if (current.current === context && epoch.current === ticket) {
          setMessage(error instanceof Error ? error.message : t('errors.unknown'));
        }
      } finally {
        if (current.current === context && epoch.current === ticket) {
          applying.current = false;
          setBusy(false);
        }
      }
    },
    [context, inspection, selection, input.onPersist, input.onSaved, t],
  );

  return {
    active,
    eligible,
    busy,
    message,
    inspection: sourceMode ? null : inspection,
    sourceMode,
    canSelectSource,
    enableSourceSelection: () => {
      setSourceMode(true);
      setSelection(null);
    },
    sourceTargets:
      sourceMode && inspection
        ? inspection.targets.filter((target) => target.editableFields.length > 0)
        : [],
    selectSource: (id: string) => {
      if (!sourceMode || !inspection || applying.current) return;
      setMessage(null);
      setSelection(
        inspection.targets.find((target) => target.id === id && target.editableFields.length > 0) ??
          null,
      );
    },
    selection: inspection ? selection : null,
    toggle: () => {
      setEnabled((value) => !value);
      setSourceMode(false);
      setSelection(null);
    },
    clearSelection: () => {
      if (!sourceMode) setSelection(null);
    },
    select,
    apply,
  };
}
