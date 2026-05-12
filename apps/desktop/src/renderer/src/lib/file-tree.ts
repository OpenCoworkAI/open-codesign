import type { WorkspaceDirectoryEntry } from '../../../preload';
import type { DesignFileEntry } from '../hooks/useDesignFiles';

export type DesignFiles = DesignFileEntry[];
export type DesignFile = DesignFiles[number];

export interface FileTreeFileNode {
  type: 'file';
  name: string;
  path: string;
  file: DesignFile;
}

export interface FileTreeDirectoryNode {
  type: 'directory';
  name: string;
  path: string;
  fileCount?: number;
  loaded?: boolean;
  loading?: boolean;
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeFileNode | FileTreeDirectoryNode;

interface MutableDirectoryNode {
  name: string;
  path: string;
  fileCount: number;
  directories: Map<string, MutableDirectoryNode>;
  files: Map<string, FileTreeFileNode>;
}

function normalizeFileTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function compareFileTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function materializeDirectory(node: MutableDirectoryNode): FileTreeDirectoryNode {
  const children: FileTreeNode[] = [
    ...Array.from(node.directories.values()).map(materializeDirectory),
    ...Array.from(node.files.values()),
  ].sort(compareFileTreeNodes);
  return {
    type: 'directory',
    name: node.name,
    path: node.path,
    fileCount: node.fileCount,
    children,
  };
}

export function buildFileTree(files: DesignFiles): FileTreeNode[] {
  const root: MutableDirectoryNode = {
    name: '',
    path: '',
    fileCount: 0,
    directories: new Map(),
    files: new Map(),
  };

  for (const file of files) {
    const normalized = normalizeFileTreePath(file.path);
    if (normalized.length === 0) continue;
    const parts = normalized.split('/').filter((part) => part.length > 0);
    if (parts.length === 0) continue;

    root.fileCount += 1;
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const nodePath = parts.slice(0, index + 1).join('/');
      const isFile = index === parts.length - 1;
      if (isFile) {
        cursor.files.set(part, {
          type: 'file',
          name: part,
          path: normalized,
          file: { ...file, path: normalized },
        });
        continue;
      }

      let next = cursor.directories.get(part);
      if (next === undefined) {
        next = {
          name: part,
          path: nodePath,
          fileCount: 0,
          directories: new Map(),
          files: new Map(),
        };
        cursor.directories.set(part, next);
      }
      next.fileCount += 1;
      cursor = next;
    }
  }

  return [
    ...Array.from(root.directories.values()).map(materializeDirectory),
    ...Array.from(root.files.values()),
  ].sort(compareFileTreeNodes);
}

export function collectDirectoryPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = [];
  function walk(items: FileTreeNode[]) {
    for (const item of items) {
      if (item.type !== 'directory') continue;
      out.push(item.path);
      walk(item.children);
    }
  }
  walk(nodes);
  return out;
}

export function defaultExpandedDirectoryPaths(nodes: FileTreeNode[]): string[] {
  return nodes
    .filter((node): node is FileTreeDirectoryNode => node.type === 'directory')
    .map((node) => node.path);
}

export function parentDirectoryPathsForFilePath(path: string): string[] {
  const parts = normalizeFileTreePath(path).split('/').filter(Boolean);
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export interface LazyDirectoryState {
  entries: WorkspaceDirectoryEntry[];
  loaded: boolean;
  loading: boolean;
}

export type LazyDirectoryMap = Record<string, LazyDirectoryState | undefined>;

export function buildLazyFileTree(directories: LazyDirectoryMap): FileTreeNode[] {
  const makeNode = (entry: WorkspaceDirectoryEntry): FileTreeNode => {
    if (entry.type === 'directory') {
      const state = directories[entry.path];
      return {
        type: 'directory',
        name: entry.name,
        path: normalizeFileTreePath(entry.path),
        ...(state?.loaded ? { fileCount: state.entries.length } : {}),
        loaded: state?.loaded === true,
        loading: state?.loading === true,
        children: state?.loaded ? state.entries.map(makeNode).sort(compareFileTreeNodes) : [],
      };
    }
    const normalizedPath = normalizeFileTreePath(entry.path);
    return {
      type: 'file',
      name: entry.name,
      path: normalizedPath,
      file: {
        path: normalizedPath,
        kind: entry.kind ?? 'asset',
        updatedAt: entry.updatedAt ?? new Date().toISOString(),
        source: 'workspace',
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      },
    };
  };

  return (directories['.']?.entries ?? []).map(makeNode).sort(compareFileTreeNodes);
}
