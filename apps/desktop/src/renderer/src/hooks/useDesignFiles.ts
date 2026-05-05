import { DEFAULT_SOURCE_ENTRY } from '@open-codesign/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceFileKind } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { tr } from '../store/lib/locale';

export type DesignFileKind = WorkspaceFileKind;
export type DesignFileSource = 'workspace' | 'preview-html';

export interface DesignFileEntry {
  path: string;
  kind: DesignFileKind;
  updatedAt: string;
  size?: number;
  source?: DesignFileSource;
}

export interface UseDesignFilesResult {
  files: DesignFileEntry[];
  loading: boolean;
  backend: 'workspace' | 'snapshots';
}

export interface WorkspaceListErrorToastState {
  key: string | null;
  toastId: string | null;
}

interface WorkspaceListErrorToastInput {
  state: WorkspaceListErrorToastState;
  key: string;
  message: string;
  pushToast: (toast: { variant: 'error'; title: string; description?: string }) => string;
  dismissToast: (id: string) => void;
}

export function handleWorkspaceListSuccessToast(
  state: WorkspaceListErrorToastState,
  dismissToast: (id: string) => void,
  staleToastIds: string[] = [],
): void {
  const dismissed = new Set<string>();
  if (state.toastId !== null) {
    dismissToast(state.toastId);
    dismissed.add(state.toastId);
  }
  for (const id of staleToastIds) {
    if (dismissed.has(id)) continue;
    dismissToast(id);
  }
  state.key = null;
  state.toastId = null;
}

export function isWorkspaceListFailureToast(toast: { description?: string }): boolean {
  const description = toast.description ?? '';
  return (
    description.includes('codesign:files:v1:list') ||
    description.includes('Failed to list workspace files')
  );
}

function currentWorkspaceListFailureToastIds(): string[] {
  return useCodesignStore
    .getState()
    .toasts.filter(isWorkspaceListFailureToast)
    .map((toast) => toast.id);
}

export function handleWorkspaceListErrorToast(input: WorkspaceListErrorToastInput): void {
  if (input.state.key === input.key) return;
  if (input.state.toastId !== null) {
    input.dismissToast(input.state.toastId);
  }
  input.state.key = input.key;
  input.state.toastId = input.pushToast({
    variant: 'error',
    title: tr('canvas.workspace.updateFailed'),
    description: input.message,
  });
}

export function previewSourceFallbackFile(
  previewSource: string | null,
  updatedAt = new Date().toISOString(),
): DesignFileEntry | null {
  if (!previewSource) return null;
  return {
    path: DEFAULT_SOURCE_ENTRY,
    kind: 'jsx',
    size: previewSource.length,
    updatedAt,
    source: 'preview-html',
  };
}

export function withPreviewSourceFallback(
  rows: DesignFileEntry[],
  previewSource: string | null,
  updatedAt?: string,
): DesignFileEntry[] {
  if (rows.length > 0) return rows;
  const fallback = previewSourceFallbackFile(previewSource, updatedAt);
  return fallback === null ? [] : [fallback];
}

/**
 * Read the design's bound workspace directory directly. The list reflects
 * whatever is on disk right now — every write path (edit tool, scaffold,
 * generate_image_asset, the user dragging a file in by hand) shows up
 * because we do not depend on any tool remembering to fire an event.
 *
 * Live updates come from two sources, both of which trigger a re-list:
 *   1. Agent stream events (`fs_updated`, `tool_call_result`, `turn_end`,
 *      `agent_end`) — fast path while a turn is in flight.
 *   2. A main-process `chokidar`-style fs watcher on the bound workspace —
 *      catches edits made in Finder / a separate IDE while the agent is
 *      idle. Throttled in main to one IPC emit per 250ms.
 */
export function useDesignFiles(designId: string | null): UseDesignFilesResult {
  const previewSource = useCodesignStore((s) => s.previewSource);
  const workspacePath = useCodesignStore((s) =>
    designId === null ? null : (s.designs.find((d) => d.id === designId)?.workspacePath ?? null),
  );
  const designUpdatedAt = useCodesignStore((s) =>
    designId === null ? undefined : s.designs.find((d) => d.id === designId)?.updatedAt,
  );
  const pushToast = useCodesignStore((s) => s.pushToast);
  const dismissToast = useCodesignStore((s) => s.dismissToast);
  const [files, setFiles] = useState<DesignFileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const listErrorToastRef = useRef<WorkspaceListErrorToastState>({ key: null, toastId: null });
  const backend: 'workspace' | 'snapshots' =
    typeof window !== 'undefined' && (window.codesign as unknown as { files?: unknown })?.files
      ? 'workspace'
      : 'snapshots';

  const refetch = useCallback(async () => {
    if (!designId) {
      handleWorkspaceListSuccessToast(
        listErrorToastRef.current,
        dismissToast,
        currentWorkspaceListFailureToastIds(),
      );
      setFiles([]);
      return;
    }
    if (backend === 'workspace') {
      if (workspacePath === null) {
        handleWorkspaceListSuccessToast(
          listErrorToastRef.current,
          dismissToast,
          currentWorkspaceListFailureToastIds(),
        );
        setFiles(withPreviewSourceFallback([], previewSource, designUpdatedAt));
        return;
      }
      try {
        setLoading(true);
        const rows = await (
          window.codesign as unknown as {
            files: {
              list: (
                id: string,
              ) => Promise<
                Array<{ path: string; kind: DesignFileKind; size: number; updatedAt: string }>
              >;
            };
          }
        ).files.list(designId);
        const workspaceRows = rows.map((r) => ({
          path: r.path,
          kind: r.kind,
          size: r.size,
          updatedAt: r.updatedAt,
          source: 'workspace' as const,
        }));
        setFiles(withPreviewSourceFallback(workspaceRows, previewSource, designUpdatedAt));
        handleWorkspaceListSuccessToast(
          listErrorToastRef.current,
          dismissToast,
          currentWorkspaceListFailureToastIds(),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : tr('errors.unknown');
        setFiles(withPreviewSourceFallback([], previewSource, designUpdatedAt));
        const errorKey = `${designId}:${workspacePath}:${message}`;
        handleWorkspaceListErrorToast({
          state: listErrorToastRef.current,
          key: errorKey,
          message,
          pushToast,
          dismissToast,
        });
      } finally {
        setLoading(false);
      }
      return;
    }
    // Legacy fallback: no files IPC → derive a single source entry from
    // the last preview if we have one. Kept so downstream tests that mock a
    // codesign-without-files preload keep passing.
    handleWorkspaceListSuccessToast(
      listErrorToastRef.current,
      dismissToast,
      currentWorkspaceListFailureToastIds(),
    );
    setFiles(withPreviewSourceFallback([], previewSource, designUpdatedAt));
  }, [designId, backend, designUpdatedAt, dismissToast, previewSource, pushToast, workspacePath]);

  // Initial fetch + refetch when the design changes.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Throttle-refetch on agent events for the same design.
  const throttleRef = useRef<{ pending: boolean; lastRun: number }>({
    pending: false,
    lastRun: 0,
  });
  useEffect(() => {
    if (backend !== 'workspace') return;
    if (!designId || !window.codesign) return;
    const off = window.codesign.chat?.onAgentEvent?.((event) => {
      if (event.designId !== designId) return;
      const relevant =
        event.type === 'fs_updated' ||
        event.type === 'tool_call_result' ||
        event.type === 'turn_end' ||
        event.type === 'agent_end';
      if (!relevant) return;
      const slot = throttleRef.current;
      const now = Date.now();
      const elapsed = now - slot.lastRun;
      if (elapsed > 250) {
        slot.lastRun = now;
        void refetch();
        return;
      }
      if (!slot.pending) {
        slot.pending = true;
        setTimeout(
          () => {
            slot.pending = false;
            slot.lastRun = Date.now();
            void refetch();
          },
          Math.max(0, 250 - elapsed),
        );
      }
    });
    return () => {
      off?.();
    };
  }, [backend, designId, refetch]);

  // Subscribe to filesystem changes outside the agent stream — Finder edits,
  // a separate IDE saving a file, git checkouts. Main coalesces bursts to
  // 250ms so this won't fire-hose readdir.
  useEffect(() => {
    if (backend !== 'workspace') return;
    if (!designId || workspacePath === null) return;
    const filesApi = window.codesign?.files as
      | {
          subscribe?: (id: string) => Promise<unknown>;
          unsubscribe?: (id: string) => Promise<unknown>;
          onChanged?: (cb: (e: { designId: string }) => void) => () => void;
        }
      | undefined;
    if (!filesApi?.subscribe || !filesApi.unsubscribe || !filesApi.onChanged) return;
    void filesApi.subscribe(designId).catch((err: unknown) => {
      pushToast({
        variant: 'error',
        title: tr('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : tr('errors.unknown'),
      });
    });
    const off = filesApi.onChanged((event) => {
      if (event.designId !== designId) return;
      void refetch();
    });
    return () => {
      off();
      void filesApi.unsubscribe?.(designId);
    };
  }, [backend, designId, pushToast, refetch, workspacePath]);

  return { files, loading, backend };
}

// Format an ISO timestamp as "22h ago" / "3d ago". Pure for testability.
export function formatRelativeTime(isoTime: string, now: Date = new Date()): string {
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Math.max(0, now.getTime() - then);
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

// Precise tooltip form: "Modified Apr 20, 2026, 14:32".
export function formatAbsoluteTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
