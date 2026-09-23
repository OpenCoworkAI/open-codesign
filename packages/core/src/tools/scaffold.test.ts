import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listScaffoldKinds, loadScaffoldManifest, makeScaffoldTool, runScaffold } from './scaffold';

const MANIFEST = {
  schemaVersion: 1,
  scaffolds: {
    'demo-frame': {
      description: 'A tiny test scaffold',
      path: 'device-frames/demo.jsx',
      category: 'device-frame',
      license: 'MIT-internal',
      source: 'test fixture',
    },
    'demo-css': {
      description: 'Another one',
      path: 'backgrounds/demo.css',
      category: 'background',
      license: 'MIT-internal',
      source: 'test fixture',
    },
    'demo-html': {
      description: 'Full HTML scaffold',
      path: 'decks/demo.html',
      category: 'deck',
      license: 'MIT-internal',
      source: 'test fixture',
    },
  },
} as const;

const cancellation = vi.hoisted(() => ({
  onWriter: (): void => {},
  afterMkdir: (): void => {},
}));
vi.mock('@open-codesign/shared/workspace-file-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-codesign/shared/workspace-file-lock')>();
  return {
    withWorkspaceFileWriter: <T>(file: string, operation: () => Promise<T>): Promise<T> => {
      const result = actual.withWorkspaceFileWriter(file, operation);
      cancellation.onWriter();
      return result;
    },
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      const result = await actual.mkdir(...args);
      cancellation.afterMkdir();
      return result;
    },
  };
});

describe('scaffold tool', () => {
  let scaffoldsRoot: string;

  beforeEach(() => {
    scaffoldsRoot = path.join(tmpdir(), `codesign-scaffold-src-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(scaffoldsRoot, 'device-frames'), { recursive: true });
    mkdirSync(path.join(scaffoldsRoot, 'backgrounds'), { recursive: true });
    mkdirSync(path.join(scaffoldsRoot, 'decks'), { recursive: true });
    writeFileSync(path.join(scaffoldsRoot, 'manifest.json'), JSON.stringify(MANIFEST), 'utf8');
    writeFileSync(
      path.join(scaffoldsRoot, 'device-frames', 'demo.jsx'),
      'export const Demo = () => null;\n',
      'utf8',
    );
    writeFileSync(
      path.join(scaffoldsRoot, 'backgrounds', 'demo.css'),
      '.demo { background: linear-gradient(red, blue); }\n',
      'utf8',
    );
    writeFileSync(
      path.join(scaffoldsRoot, 'decks', 'demo.html'),
      '<!doctype html><html><body><main>Deck</main></body></html>\n',
      'utf8',
    );
  });

  afterEach(() => {
    cancellation.onWriter = () => {};
    cancellation.afterMkdir = () => {};
    rmSync(scaffoldsRoot, { recursive: true, force: true });
  });

  it('retains a queued scaffold until settlement but never publishes after cancellation', async () => {
    const dest = path.join(scaffoldsRoot, 'output.jsx');
    writeFileSync(dest, 'existing user source');
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = (): void => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holder = withWorkspaceFileWriter(dest, async () => {
      entered();
      await gate;
    });
    await started;
    let attempted = (): void => {};
    const queued = new Promise<void>((resolve) => {
      attempted = resolve;
    });
    cancellation.onWriter = attempted;
    const controller = new AbortController();
    const onScaffolded = vi.fn();
    let settled = false;
    const copy = makeScaffoldTool(
      () => scaffoldsRoot,
      () => scaffoldsRoot,
      { onScaffolded },
    )
      .execute('cancel-copy', { kind: 'demo-frame', destPath: 'output.jsx' }, controller.signal)
      .finally(() => {
        settled = true;
      });
    const result = Promise.allSettled([copy]);
    try {
      await queued;
      controller.abort();
      await setImmediate();
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await holder;
    expect(await result).toMatchObject([{ status: 'rejected', reason: { name: 'AbortError' } }]);
    expect(readFileSync(dest, 'utf8')).toBe('existing user source');
    expect(onScaffolded).not.toHaveBeenCalled();
    await expect(withWorkspaceFileWriter(dest, async () => 'released')).resolves.toBe('released');
  });

  it('checks cancellation before work and after mkdir before the OS write', async () => {
    const dest = path.join(scaffoldsRoot, 'output.jsx');
    writeFileSync(dest, 'existing user source');
    const controller = new AbortController();
    const onScaffolded = vi.fn();
    const tool = makeScaffoldTool(
      () => scaffoldsRoot,
      () => scaffoldsRoot,
      { onScaffolded },
    );
    cancellation.afterMkdir = () => controller.abort();
    await expect(
      tool.execute(
        'abort-at-mkdir',
        {
          kind: 'demo-frame',
          destPath: 'output.jsx',
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(readFileSync(dest, 'utf8')).toBe('existing user source');
    expect(onScaffolded).not.toHaveBeenCalled();
    await expect(
      tool.execute(
        'already-aborted',
        {
          kind: 'demo-frame',
          destPath: 'output.jsx',
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('manifest loads and contains entries', async () => {
    const m = await loadScaffoldManifest(scaffoldsRoot);
    expect(m.schemaVersion).toBe(1);
    expect(Object.keys(m.scaffolds).length).toBe(3);
  });

  it('listScaffoldKinds returns sorted unique keys', async () => {
    const kinds = await listScaffoldKinds(scaffoldsRoot);
    expect(kinds).toEqual([...kinds].sort());
    expect(kinds).toContain('demo-frame');
  });

  it('runScaffold copies a known kind into the workspace', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const result = await runScaffold({
        kind: 'demo-frame',
        destPath: 'frames/test.jsx',
        workspaceRoot: wsroot,
        scaffoldsRoot,
      });
      expect(result.ok).toBe(true);
      expect(result.written?.startsWith(wsroot)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('preserves the source scaffold extension when the requested destination is wrong', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const result = await runScaffold({
        kind: 'demo-html',
        destPath: '_starters/slide-deck.jsx',
        workspaceRoot: wsroot,
        scaffoldsRoot,
      });
      expect(result).toMatchObject({
        ok: true,
        destPath: '_starters/slide-deck.html',
        requestedDestPath: '_starters/slide-deck.jsx',
      });
      expect(existsSync(path.join(wsroot, '_starters', 'slide-deck.html'))).toBe(true);
      expect(existsSync(path.join(wsroot, '_starters', 'slide-deck.jsx'))).toBe(false);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('normalizes legacy EDITMODE blocks while copying stale templates', async () => {
    writeFileSync(
      path.join(scaffoldsRoot, 'device-frames', 'demo.jsx'),
      `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accentColor: '#0a84ff',
  scale: 1,
} /*EDITMODE-END*/;
export const Demo = () => null;
`,
      'utf8',
    );
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const result = await runScaffold({
        kind: 'demo-frame',
        destPath: 'frames/test.jsx',
        workspaceRoot: wsroot,
        scaffoldsRoot,
      });
      expect(result).toMatchObject({ ok: true, normalizedEditmode: true });
      const written = readFileSync(path.join(wsroot, 'frames', 'test.jsx'), 'utf8');
      expect(written).toContain('"accentColor": "#0a84ff"');
      expect(written).not.toContain("accentColor: '#0a84ff'");
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('refuses unknown kinds', async () => {
    const r = await runScaffold({
      kind: 'definitely-not-a-real-scaffold',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
      scaffoldsRoot,
    });
    expect(r.ok).toBe(false);
  });

  it('refuses destinations in sibling paths with the same prefix', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    const sibling = `${wsroot}-sibling`;
    mkdirSync(wsroot, { recursive: true });
    try {
      const r = await runScaffold({
        kind: 'demo-frame',
        destPath: path.relative(wsroot, path.join(sibling, 'escape.jsx')),
        workspaceRoot: wsroot,
        scaffoldsRoot,
      });
      expect(r).toMatchObject({ ok: false, reason: 'destination outside workspace' });
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('refuses destinations that traverse symlinked workspace segments', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    const outside = path.join(tmpdir(), `codesign-scaffold-out-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    try {
      try {
        symlinkSync(outside, path.join(wsroot, 'linked'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      const r = await runScaffold({
        kind: 'demo-frame',
        destPath: 'linked/escape.jsx',
        workspaceRoot: wsroot,
        scaffoldsRoot,
      });

      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/symbolic link/);
      expect(existsSync(path.join(outside, 'escape.jsx'))).toBe(false);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses manifest entries that point outside the templates root', async () => {
    writeFileSync(
      path.join(scaffoldsRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        scaffolds: {
          escape: {
            description: 'bad',
            path: '../../outside.jsx',
            license: 'MIT-internal',
            source: 'test fixture',
          },
        },
      }),
      'utf8',
    );
    const r = await runScaffold({
      kind: 'escape',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
      scaffoldsRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside templates root/);
  });

  it('refuses scaffold sources that traverse symlinked template segments', async () => {
    const outside = path.join(
      tmpdir(),
      `codesign-scaffold-source-out-${process.pid}-${Date.now()}`,
    );
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, 'leak.jsx'), 'export const Leak = true;\n', 'utf8');
    try {
      try {
        symlinkSync(outside, path.join(scaffoldsRoot, 'linked'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }
      writeFileSync(
        path.join(scaffoldsRoot, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          scaffolds: {
            leak: {
              description: 'bad',
              path: 'linked/leak.jsx',
              license: 'MIT-internal',
              source: 'test fixture',
            },
          },
        }),
        'utf8',
      );

      const r = await runScaffold({
        kind: 'leak',
        destPath: 'x.jsx',
        workspaceRoot: tmpdir(),
        scaffoldsRoot,
      });

      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/symbolic link/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('requires scaffold entries to declare license and source', async () => {
    writeFileSync(
      path.join(scaffoldsRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        scaffolds: {
          broken: {
            description: 'missing source',
            path: 'device-frames/demo.jsx',
            license: 'MIT-internal',
          },
        },
      }),
      'utf8',
    );

    const r = await runScaffold({
      kind: 'broken',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
      scaffoldsRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/source/);
  });

  it('reports missing manifest with a helpful reason', async () => {
    const r = await runScaffold({
      kind: 'demo-frame',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
      scaffoldsRoot: path.join(scaffoldsRoot, 'does-not-exist'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/manifest/i);
  });

  it('reports malformed manifest shape with a helpful reason', async () => {
    writeFileSync(
      path.join(scaffoldsRoot, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, scaffolds: [] }),
      'utf8',
    );

    const r = await runScaffold({
      kind: 'demo-frame',
      destPath: 'x.jsx',
      workspaceRoot: tmpdir(),
      scaffoldsRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/manifest\.scaffolds must be an object/);
  });

  it('makeScaffoldTool returns error details when no workspace is attached', async () => {
    const tool = makeScaffoldTool(
      () => null,
      () => scaffoldsRoot,
    );
    const result = await tool.execute('call-1', { kind: 'demo-frame', destPath: 'out.jsx' });
    expect(result.details).toMatchObject({ ok: false });
    expect((result.details as { reason: string }).reason).toMatch(/no workspace/i);
  });

  it('makeScaffoldTool returns error details when scaffolds root is not configured', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-ws-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const tool = makeScaffoldTool(
        () => wsroot,
        () => null,
      );
      const result = await tool.execute('call-1', {
        kind: 'demo-frame',
        destPath: 'out.jsx',
      });
      expect(result.details).toMatchObject({ ok: false });
      expect((result.details as { reason: string }).reason).toMatch(/scaffolds/i);
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('makeScaffoldTool writes a scaffold into the provided workspace', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-tool-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const tool = makeScaffoldTool(
        () => wsroot,
        () => scaffoldsRoot,
      );
      const result = await tool.execute('call-2', { kind: 'demo-frame', destPath: 'out.jsx' });
      const details = result.details as {
        ok: boolean;
        written?: string;
        bytes?: number;
        kind?: string;
      };
      expect(details.ok).toBe(true);
      expect(details.written?.startsWith(wsroot)).toBe(true);
      expect(details.bytes).toBeGreaterThan(0);
      expect(details.kind).toBe('demo-frame');
      expect((details as { destPath?: string }).destPath).toBe('out.jsx');
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('makeScaffoldTool reports the adjusted destination path', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-tool-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    try {
      const tool = makeScaffoldTool(
        () => wsroot,
        () => scaffoldsRoot,
      );
      const result = await tool.execute('call-3', {
        kind: 'demo-html',
        destPath: '_starters/slide-deck.jsx',
      });
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').toContain(
        '_starters/slide-deck.html',
      );
      expect(result.details).toMatchObject({
        ok: true,
        kind: 'demo-html',
        destPath: '_starters/slide-deck.html',
        requestedDestPath: '_starters/slide-deck.jsx',
      });
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });

  it('makeScaffoldTool calls the post-write hook with the actual destination', async () => {
    const wsroot = path.join(tmpdir(), `codesign-scaffold-tool-${process.pid}-${Date.now()}`);
    mkdirSync(wsroot, { recursive: true });
    const onScaffolded = vi.fn();
    try {
      const tool = makeScaffoldTool(
        () => wsroot,
        () => scaffoldsRoot,
        { onScaffolded },
      );
      await tool.execute('call-4', {
        kind: 'demo-html',
        destPath: '_starters/slide-deck.jsx',
      });
      expect(onScaffolded).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          destPath: '_starters/slide-deck.html',
          requestedDestPath: '_starters/slide-deck.jsx',
        }),
      );
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });
});
