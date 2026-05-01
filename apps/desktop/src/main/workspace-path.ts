import path from 'node:path';

function stripTrailingSlash(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, '');
}

function isWindowsWorkspaceAbsolute(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || /^\/\/[^/]+\/[^/]+/.test(value);
}

function isCurrentPlatformWorkspaceAbsolute(value: string): boolean {
  if (process.platform === 'win32') {
    return isWindowsWorkspaceAbsolute(value);
  }
  return value.startsWith('/');
}

export function normalizeWorkspacePath(rawPath: string): string {
  const normalizedSeparators = rawPath.replaceAll('\\', '/');
  if (normalizedSeparators.trim().length === 0) {
    throw new Error('Workspace path must not be empty');
  }
  if (!isCurrentPlatformWorkspaceAbsolute(normalizedSeparators)) {
    throw new Error('Workspace path must be absolute for the current platform');
  }
  const normalized =
    process.platform === 'win32'
      ? path.win32.normalize(normalizedSeparators).replaceAll('\\', '/')
      : path.posix.normalize(normalizedSeparators);
  return stripTrailingSlash(normalized);
}

export function assertWorkspacePath(rawPath: string): string {
  return normalizeWorkspacePath(rawPath);
}
