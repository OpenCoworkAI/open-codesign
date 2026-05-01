import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { walkWorkspaceFiles } from './files-ipc';

describe('walkWorkspaceFiles', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'oc-files-ipc-'));
  });

  it('returns empty array for an empty workspace', async () => {
    const files = await walkWorkspaceFiles(workspaceDir);
    expect(files).toEqual([]);
  });

  it('lists html and asset files at the root', async () => {
    await writeFile(path.join(workspaceDir, 'index.html'), '<html></html>');
    await writeFile(path.join(workspaceDir, 'styles.css'), 'body{}');
    await writeFile(path.join(workspaceDir, 'app.js'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('styles.css');
    expect(paths).toContain('app.js');
  });

  it('marks .html and .htm as kind=html', async () => {
    await writeFile(path.join(workspaceDir, 'a.html'), '');
    await writeFile(path.join(workspaceDir, 'b.htm'), '');
    await writeFile(path.join(workspaceDir, 'c.css'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(byPath['a.html']).toBe('html');
    expect(byPath['b.htm']).toBe('html');
    expect(byPath['c.css']).toBe('asset');
  });

  it('sorts html files first, then assets, both alphabetical', async () => {
    await writeFile(path.join(workspaceDir, 'zzz.html'), '');
    await writeFile(path.join(workspaceDir, 'aaa.css'), '');
    await writeFile(path.join(workspaceDir, 'bbb.html'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    expect(files.map((f) => f.path)).toEqual(['bbb.html', 'zzz.html', 'aaa.css']);
  });

  it('walks nested directories', async () => {
    await mkdir(path.join(workspaceDir, 'sub'));
    await writeFile(path.join(workspaceDir, 'sub', 'page.html'), '');
    await writeFile(path.join(workspaceDir, 'sub', 'logo.svg'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('sub/page.html');
    expect(paths).toContain('sub/logo.svg');
  });

  it('skips standard heavy/build directories', async () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', '.next']) {
      await mkdir(path.join(workspaceDir, dir));
      await writeFile(path.join(workspaceDir, dir, 'inside.html'), '');
    }
    await writeFile(path.join(workspaceDir, 'visible.html'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(['visible.html']);
  });

  it('skips hidden (dotfile) entries', async () => {
    await writeFile(path.join(workspaceDir, '.env'), 'SECRET=1');
    await writeFile(path.join(workspaceDir, '.hidden.html'), '');
    await writeFile(path.join(workspaceDir, 'visible.html'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    expect(files.map((f) => f.path)).toEqual(['visible.html']);
  });

  it('skips files without an allowed extension', async () => {
    await writeFile(path.join(workspaceDir, 'binary.exe'), '');
    await writeFile(path.join(workspaceDir, 'Makefile'), '');
    await writeFile(path.join(workspaceDir, 'page.html'), '');
    const files = await walkWorkspaceFiles(workspaceDir);
    expect(files.map((f) => f.path)).toEqual(['page.html']);
  });

  it('returns size and ISO mtime per entry', async () => {
    const content = 'hello world';
    await writeFile(path.join(workspaceDir, 'page.html'), content);
    const files = await walkWorkspaceFiles(workspaceDir);
    expect(files).toHaveLength(1);
    expect(files[0]?.size).toBe(content.length);
    expect(files[0]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respects the max-files cap', async () => {
    for (let i = 0; i < 10; i++) {
      await writeFile(path.join(workspaceDir, `file-${i}.html`), '');
    }
    const files = await walkWorkspaceFiles(workspaceDir, 3);
    expect(files).toHaveLength(3);
  });

  it('handles unreadable directories gracefully', async () => {
    // Walking a non-existent path returns [] rather than throwing -- the
    // workspace folder might have been deleted between the bind and the
    // list call and the panel should just go empty.
    const files = await walkWorkspaceFiles(path.join(workspaceDir, 'does-not-exist'));
    expect(files).toEqual([]);
  });
});
