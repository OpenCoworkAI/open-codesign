/**
 * Shared filtering rules for the two workspace walkers in the main process:
 * `seedFsMapFromWorkspace` (sync, loads file content for the agent) and
 * `walkWorkspaceFiles` (async, lists metadata for the Files panel). Keep
 * them in lockstep -- diverging would mean the agent and the panel disagree
 * on what counts as a workspace file.
 */

export const WORKSPACE_WALK_MAX_FILES = 500;

export const WORKSPACE_SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.cache',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  '.idea',
  '.vscode',
  'coverage',
  '.codesign',
]);

export function shouldSkipDirEntry(name: string): boolean {
  return WORKSPACE_SKIP_DIRS.has(name) || name.startsWith('.');
}

export function shouldSkipFileEntry(name: string): boolean {
  return name.startsWith('.');
}
