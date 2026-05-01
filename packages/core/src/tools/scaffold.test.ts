import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  },
} as const;

describe('scaffold tool', () => {
  let scaffoldsRoot: string;

  beforeEach(() => {
    scaffoldsRoot = path.join(tmpdir(), `codesign-scaffold-src-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(scaffoldsRoot, 'device-frames'), { recursive: true });
    mkdirSync(path.join(scaffoldsRoot, 'backgrounds'), { recursive: true });
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
  });

  afterEach(() => {
    rmSync(scaffoldsRoot, { recursive: true, force: true });
  });

  it('manifest loads and contains entries', async () => {
    const m = await loadScaffoldManifest(scaffoldsRoot);
    expect(m.schemaVersion).toBe(1);
    expect(Object.keys(m.scaffolds).length).toBe(2);
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
    } finally {
      rmSync(wsroot, { recursive: true, force: true });
    }
  });
});
