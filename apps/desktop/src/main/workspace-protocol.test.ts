import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorkspaceUrl } from './workspace-protocol';

describe('resolveWorkspaceUrl', () => {
  let workspaceDir: string;
  const designId = 'abc123';
  const resolveWorkspace = (id: string): string | null => {
    if (id === designId) return workspaceDir;
    return null;
  };

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'oc-wsproto-'));
    await writeFile(path.join(workspaceDir, 'index.html'), '<html></html>');
  });

  afterEach(async () => {
    // best-effort -- vitest cleans tmp eventually
  });

  it('resolves a basic workspace url to the file inside the workspace', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/index.html`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.absPath).toBe(path.resolve(workspaceDir, 'index.html'));
      expect(r.value.mime).toMatch(/^text\/html/);
      expect(r.value.designId).toBe(designId);
      expect(r.value.relPath).toBe('index.html');
    }
  });

  it('defaults empty path to index.html', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.relPath).toBe('index.html');
  });

  it('defaults trailing-slash directory path to <dir>/index.html', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/sub/`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.relPath).toBe('sub/index.html');
  });

  it('rejects non-workspace scheme', () => {
    const r = resolveWorkspaceUrl(`https://${designId}/index.html`, resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad_url');
  });

  it('rejects empty designId', () => {
    const r = resolveWorkspaceUrl('workspace:///index.html', resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad_url');
  });

  it('rejects designId with invalid characters', () => {
    const r = resolveWorkspaceUrl('workspace://bad..id/index.html', resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad_url');
  });

  it('rejects designId not in DB', () => {
    const r = resolveWorkspaceUrl('workspace://unknown_id/index.html', resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown_design');
  });

  it('cannot escape workspace via plain ../ (URL parser normalizes)', () => {
    // WHATWG URL normalizes `..` segments inside the path before our code
    // sees them, so `..` collapses against the host root rather than walking
    // above the workspace. The final path is always inside the workspace.
    const r = resolveWorkspaceUrl(`workspace://${designId}/../etc/passwd.html`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.relPath).toBe('etc/passwd.html');
      expect(r.value.absPath.startsWith(workspaceDir)).toBe(true);
    }
  });

  it('cannot escape workspace via deeply nested ../', () => {
    const r = resolveWorkspaceUrl(
      `workspace://${designId}/sub/../../../etc/passwd.html`,
      resolveWorkspace,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.relPath).toBe('etc/passwd.html');
      expect(r.value.absPath.startsWith(workspaceDir)).toBe(true);
    }
  });

  it('cannot escape workspace via URL-encoded ../ (parser collapses %2e%2e too)', () => {
    // WHATWG URL normalizes both plain and percent-encoded double-dot
    // segments, so even `%2e%2e` cannot walk above the host. Defense-in-depth
    // path.resolve guard remains in place for any future parser quirks.
    const r = resolveWorkspaceUrl(
      `workspace://${designId}/%2e%2e/%2e%2e/etc/passwd.html`,
      resolveWorkspace,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.relPath).toBe('etc/passwd.html');
      expect(r.value.absPath.startsWith(workspaceDir)).toBe(true);
    }
  });

  it('rejects null byte injection', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/index.html%00.png`, resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad_url');
  });

  it('rejects unsupported MIME types (.exe)', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/malware.exe`, resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_mime');
  });

  it('rejects files without an extension', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/Makefile`, resolveWorkspace);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_mime');
  });

  it('accepts common static assets', () => {
    const cases = [
      ['styles.css', 'text/css'],
      ['app.js', 'application/javascript'],
      ['module.mjs', 'application/javascript'],
      ['logo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['icon.svg', 'image/svg+xml'],
      ['font.woff2', 'font/woff2'],
      ['data.json', 'application/json'],
    ] as const;
    for (const [file, mimePrefix] of cases) {
      const r = resolveWorkspaceUrl(`workspace://${designId}/${file}`, resolveWorkspace);
      expect(r.ok, `${file} should resolve`).toBe(true);
      if (r.ok) expect(r.value.mime.startsWith(mimePrefix)).toBe(true);
    }
  });

  it('preserves nested paths', () => {
    const r = resolveWorkspaceUrl(
      `workspace://${designId}/assets/icons/check.svg`,
      resolveWorkspace,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.relPath).toBe('assets/icons/check.svg');
  });

  it('strips query string when resolving (cache busters do not change path)', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/index.html?v=abc123`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.relPath).toBe('index.html');
  });

  it('handles URL-encoded spaces in filenames', () => {
    const r = resolveWorkspaceUrl(`workspace://${designId}/My%20File.html`, resolveWorkspace);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.relPath).toBe('My File.html');
  });
});
