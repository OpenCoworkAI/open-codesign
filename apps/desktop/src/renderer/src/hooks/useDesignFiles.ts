import { useEffect, useState } from 'react';
import { useCodesignStore } from '../store';

export type DesignFileKind = 'html' | 'asset';

export interface DesignFileEntry {
  path: string;
  kind: DesignFileKind;
  updatedAt: string;
  size?: number;
}

export interface UseDesignFilesResult {
  files: DesignFileEntry[];
  loading: boolean;
  backend: 'snapshots' | 'files-ipc';
}

// Two backends:
//   - files-ipc: design has a bound workspace folder. Main walks it and
//     returns real files (html + assets). Refreshed whenever previewHtml
//     flips so freshly-written files appear without a manual refresh.
//   - snapshots: legacy / no-workspace mode. Synthesize a single virtual
//     `index.html` row from the in-memory previewHtml + the latest snapshot
//     timestamp.
export function useDesignFiles(designId: string | null): UseDesignFilesResult {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const designs = useCodesignStore((s) => s.designs);
  const currentDesign = designId ? designs.find((d) => d.id === designId) : undefined;
  const useWorkspaceBackend = currentDesign?.workspacePath != null;

  const [latestSnapshotAt, setLatestSnapshotAt] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<DesignFileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Workspace-backed listing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewHtml is intentionally a fresh-write signal
  useEffect(() => {
    if (!useWorkspaceBackend || !designId || !window.codesign?.files?.list) {
      setWorkspaceFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.codesign.files
      .list(designId)
      .then((res) => {
        if (cancelled) return;
        setWorkspaceFiles(
          res.files.map((f) => ({
            path: f.path,
            kind: f.kind,
            updatedAt: f.updatedAt,
            size: f.size,
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceFiles([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designId, useWorkspaceBackend, previewHtml]);

  // Snapshots-backed timestamp -- only run in fallback mode to skip a wasted
  // IPC round-trip when the workspace backend already ships per-file mtimes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewHtml is intentionally a fresh-generation signal
  useEffect(() => {
    if (useWorkspaceBackend) {
      setLatestSnapshotAt(null);
      return;
    }
    if (!designId || !window.codesign) {
      setLatestSnapshotAt(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.codesign.snapshots
      .list(designId)
      .then((snaps) => {
        if (cancelled) return;
        setLatestSnapshotAt(snaps[0]?.createdAt ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setLatestSnapshotAt(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [designId, useWorkspaceBackend, previewHtml]);

  if (useWorkspaceBackend) {
    return { files: workspaceFiles, loading, backend: 'files-ipc' };
  }

  const files: DesignFileEntry[] = [];
  if (designId && previewHtml) {
    const updatedAt = latestSnapshotAt ?? currentDesign?.updatedAt ?? new Date().toISOString();
    files.push({ path: 'index.html', kind: 'html', updatedAt, size: previewHtml.length });
  }

  return { files, loading, backend: 'snapshots' };
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
