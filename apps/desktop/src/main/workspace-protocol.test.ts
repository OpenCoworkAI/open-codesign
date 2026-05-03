import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveWorkspaceSafePath, resolveWorkspaceUrl } from './workspace-protocol';

vi.mock('./electron-runtime', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

describe('resolveWorkspaceUrl', () => {
  let workspaceDir: string;
  const designId = 'abc123';
  const resolveWorkspace = (id: string): string | null => (id === designId ? workspaceDir : null);

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'oc-wsproto-'));
    await writeFile(path.join(workspaceDir, 'index.html'), '<html></html>');
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it('resolves a workspace URL to a file inside the design workspace', () => {
    const result = resolveWorkspaceUrl(`workspace://${designId}/index.html`, resolveWorkspace);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.absPath).toBe(path.resolve(workspaceDir, 'index.html'));
    expect(result.value.mime).toMatch(/^text\/html/);
    expect(result.value.designId).toBe(designId);
    expect(result.value.relPath).toBe('index.html');
  });

  it('defaults empty and directory paths to index.html', () => {
    const root = resolveWorkspaceUrl(`workspace://${designId}/`, resolveWorkspace);
    const nested = resolveWorkspaceUrl(`workspace://${designId}/screens/`, resolveWorkspace);

    expect(root.ok && root.value.relPath).toBe('index.html');
    expect(nested.ok && nested.value.relPath).toBe('screens/index.html');
  });

  it('rejects unknown designs and unsupported file extensions', () => {
    const unknown = resolveWorkspaceUrl('workspace://unknown/index.html', resolveWorkspace);
    const unsupported = resolveWorkspaceUrl(`workspace://${designId}/Makefile`, resolveWorkspace);

    expect(unknown).toEqual({ ok: false, error: 'unknown_design' });
    expect(unsupported).toEqual({ ok: false, error: 'unsupported_mime' });
  });

  it('handles encoded spaces without allowing traversal outside the workspace', () => {
    const spaced = resolveWorkspaceUrl(`workspace://${designId}/My%20File.html`, resolveWorkspace);
    const traversal = resolveWorkspaceUrl(
      `workspace://${designId}/sub/%2e%2e/%2e%2e/etc/passwd.html`,
      resolveWorkspace,
    );

    expect(spaced.ok && spaced.value.relPath).toBe('My File.html');
    expect(traversal.ok).toBe(true);
    if (traversal.ok) {
      expect(traversal.value.relPath).toBe('etc/passwd.html');
      expect(traversal.value.absPath.startsWith(workspaceDir)).toBe(true);
    }
  });

  it('rejects symlinked workspace paths during safe resolution', async () => {
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'oc-wsproto-outside-'));
    try {
      await writeFile(path.join(outsideDir, 'secret.html'), '<html>secret</html>');
      try {
        await symlink(outsideDir, path.join(workspaceDir, 'linked'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      const resolved = resolveWorkspaceUrl(
        `workspace://${designId}/linked/secret.html`,
        resolveWorkspace,
      );
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;

      await expect(resolveWorkspaceSafePath(resolved.value)).resolves.toEqual({
        ok: false,
        error: 'traversal',
      });
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
