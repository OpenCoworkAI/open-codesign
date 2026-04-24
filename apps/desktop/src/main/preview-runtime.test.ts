import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPreview } from './preview-runtime';

// Puppeteer-core is a thin Chrome DevTools client — when no system Chrome is
// discoverable (typical CI sandbox), the module itself still imports fine but
// `findSystemChrome` throws EXPORTER_NO_CHROME. We key availability off that
// discovery so CI runs stay green without Chrome installed.
async function canRunChrome(): Promise<boolean> {
  try {
    const { findSystemChrome } = await import('@open-codesign/exporters');
    await findSystemChrome();
    return true;
  } catch {
    return false;
  }
}

const chromeAvailable = await canRunChrome();
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
const describeIfChrome = chromeAvailable ? describe : describe.skip;

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
});

describeIfChrome('runPreview with real Chrome', () => {
  it('captures console errors from the rendered page', async () => {
    const file = join(tempDir, 'boom.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><h1>Hi</h1><script>console.error("boom");</script></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'boom.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.consoleErrors.some((e) => /boom/.test(e.message))).toBe(true);
    expect(result.metrics.nodes).toBeGreaterThan(0);
  }, 30_000);

  it('returns a DOM outline (not a screenshot) when vision=false', async () => {
    const file = join(tempDir, 'plain.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><main><section><p>A</p></section></main></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'plain.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.screenshot).toBeUndefined();
    expect(typeof result.domOutline).toBe('string');
    expect((result.domOutline ?? '').length).toBeGreaterThan(0);
  }, 30_000);
});
