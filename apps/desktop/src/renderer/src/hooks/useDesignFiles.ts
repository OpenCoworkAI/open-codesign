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

// TODO: Workstream E — swap the implementation of this hook to call
// `window.codesign.files.list(designId)` once the files-ipc namespace lands.
// The hook signature (DesignFileEntry[]) stays stable, so consumers do not
// change. Until then we derive a single virtual `index.html` file from the
// latest snapshot in `design_snapshots`.
export function useDesignFiles(designId: string | null): UseDesignFilesResult {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const designs = useCodesignStore((s) => s.designs);
  const [latestSnapshotAt, setLatestSnapshotAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const filesIpcAvailable =
    typeof window !== 'undefined' &&
    Boolean((window.codesign as unknown as { files?: unknown })?.files);

  // Look up the latest snapshot timestamp for the current design so the Files
  // panel can show "N minutes ago" next to the sole `index.html` row. We
  // debounce on designId + previewHtml so a fresh generation refreshes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewHtml is intentionally listed as a fresh-generation signal
  useEffect(() => {
    let cancelled = false;
    if (!designId || !window.codesign) {
      setLatestSnapshotAt(null);
      return;
    }
    setLoading(true);
    // TODO(v0.2/T2.4): re-route through session JSONL — see T2.6.
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
  }, [designId, previewHtml]);

  const files: DesignFileEntry[] = [];
  if (designId && previewHtml) {
    const design = designs.find((d) => d.id === designId);
    const updatedAt = latestSnapshotAt ?? design?.updatedAt ?? new Date().toISOString();
    files.push({ path: 'index.html', kind: 'html', updatedAt, size: previewHtml.length });
  }

  return {
    files,
    loading,
    backend: filesIpcAvailable ? 'files-ipc' : 'snapshots',
  };
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
