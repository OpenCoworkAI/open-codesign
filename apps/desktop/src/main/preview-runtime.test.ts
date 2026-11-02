import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isPreviewFileUrlAllowed,
  isRuntimeConsoleNoise,
  isRuntimeOptionalFontUrl,
  previewIncludesRuntimeFontLinks,
  runPreview,
} from './preview-runtime';

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-preview-runtime-'));
});

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('runPreview path guards', () => {
  it('refuses paths that escape the workspace', async () => {
    const result = await runPreview({
      path: '../etc/passwd',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/escapes workspace root/);
  });

  it('reports read failure when the target does not exist', async () => {
    const result = await runPreview({
      path: 'missing.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/read failed/);
  });

  it('refuses preview sources through symlinked workspace segments', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-outside-'));
    try {
      mkdirSync(join(tempDir, 'linked-parent'), { recursive: true });
      try {
        symlinkSync(outside, join(tempDir, 'linked-parent', 'linked'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }
      writeFileSync(join(outside, 'index.html'), '<main>outside</main>', 'utf8');

      const result = await runPreview({
        path: 'linked-parent/linked/index.html',
        vision: false,
        workspaceRoot: tempDir,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/symbolic link/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('allows only preview temp file and safe workspace file URLs', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-url-outside-'));
    const previewFile = join(outside, 'preview.html');
    const safeFile = join(tempDir, 'asset.txt');
    writeFileSync(previewFile, '<main/>', 'utf8');
    writeFileSync(safeFile, 'asset', 'utf8');
    try {
      expect(
        await isPreviewFileUrlAllowed(pathToFileURL(previewFile).href, tempDir, previewFile),
      ).toBe(true);
      expect(
        await isPreviewFileUrlAllowed(pathToFileURL(safeFile).href, tempDir, previewFile),
      ).toBe(true);
      expect(
        await isPreviewFileUrlAllowed(
          pathToFileURL(join(outside, 'secret.txt')).href,
          tempDir,
          previewFile,
        ),
      ).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('blocks file URLs that traverse symlinked workspace segments', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-url-link-outside-'));
    const previewFile = join(outside, 'preview.html');
    writeFileSync(previewFile, '<main/>', 'utf8');
    writeFileSync(join(outside, 'secret.txt'), 'secret', 'utf8');
    try {
      try {
        symlinkSync(outside, join(tempDir, 'asset-link'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      expect(
        await isPreviewFileUrlAllowed(
          pathToFileURL(join(tempDir, 'asset-link', 'secret.txt')).href,
          tempDir,
          previewFile,
        ),
      ).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(tempDir, 'asset-link'), { recursive: true, force: true });
    }
  });

  it('reports unsupported file types before launching Chrome', async () => {
    writeFileSync(join(tempDir, 'style.css'), 'body { color: red; }', 'utf8');
    const result = await runPreview({
      path: 'style.css',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unsupported preview file type/);
  });
});

describe('runtime noise filtering', () => {
  it('recognizes explicitly marked runtime font subsets without requiring Fraunces first', () => {
    expect(
      previewIncludesRuntimeFontLinks(
        '<link data-codesign-runtime-fonts href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&amp;display=swap" rel="stylesheet" />',
      ),
    ).toBe(true);
    expect(previewIncludesRuntimeFontLinks('<main>System fonts only</main>')).toBe(false);
    expect(
      previewIncludesRuntimeFontLinks(
        '<link href="https://fonts.googleapis.com/css2?family=Custom" />',
      ),
    ).toBe(false);
  });
  it('recognizes only the optional fonts injected by the JSX preview wrapper', () => {
    expect(
      isRuntimeOptionalFontUrl(
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap',
      ),
    ).toBe(true);
    expect(isRuntimeOptionalFontUrl('https://fonts.gstatic.com/s/dmsans/v16/example.woff2')).toBe(
      true,
    );
    expect(isRuntimeOptionalFontUrl('https://example.com/assets/hero.png')).toBe(false);
    expect(isRuntimeOptionalFontUrl('file:///tmp/workspace/assets/hero.png')).toBe(false);
  });

  it('filters optional runtime font console failures only when the wrapper is active', () => {
    const message = 'Failed to load resource: net::ERR_NETWORK_CHANGED';
    const locationUrl =
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap';
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl,
      }),
    ).toBe(true);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: false,
        locationUrl,
      }),
    ).toBe(false);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl: 'https://example.com/assets/hero.png',
      }),
    ).toBe(false);
  });
});
