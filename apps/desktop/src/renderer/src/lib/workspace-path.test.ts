import { describe, expect, it } from 'vitest';
import { workspacePathComparisonKey } from './workspace-path';

describe('workspacePathComparisonKey', () => {
  it('normalizes separators and trailing slashes on all platforms', () => {
    expect(workspacePathComparisonKey('C:\\Work\\Project\\', 'Win32')).toBe('c:/work/project');
    expect(workspacePathComparisonKey('/tmp/workspace/', 'Linux x86_64')).toBe('/tmp/workspace');
  });

  it('preserves case on non-Windows platforms', () => {
    expect(workspacePathComparisonKey('/Users/Roy/Workspace', 'MacIntel')).not.toBe(
      workspacePathComparisonKey('/users/roy/workspace', 'MacIntel'),
    );
  });

  it('folds case on Windows platforms', () => {
    expect(workspacePathComparisonKey('C:/Work/Project', 'Win32')).toBe(
      workspacePathComparisonKey('c:/work/project/', 'Win32'),
    );
  });

  it('preserves root paths when stripping trailing slashes', () => {
    expect(workspacePathComparisonKey('C:/', 'Win32')).toBe('c:/');
    expect(workspacePathComparisonKey('/', 'Linux')).toBe('/');
  });
});
