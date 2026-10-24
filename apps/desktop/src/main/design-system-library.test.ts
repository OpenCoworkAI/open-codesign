import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignSystemLibrary } from './design-system-library';

const VALID = `---
version: alpha
name: Studio
colors:
  background: "#ffffff"
  text: "#161616"
  accent: "#0055aa"
typography:
  body:
    fontFamily: system-ui
    fontSize: 16px
rounded:
  control: 8px
spacing:
  unit: 8px
---
## Overview
A compact studio interface.
`;

describe('design system library', () => {
  let dir: string;
  let library: DesignSystemLibrary;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'codesign-systems-'));
    const builtinRoot = path.join(dir, 'brands');
    for (const slug of ['ibm', 'vercel', 'stripe']) {
      await mkdir(path.join(builtinRoot, slug), { recursive: true });
      await writeFile(path.join(builtinRoot, slug, 'DESIGN.md'), VALID);
    }
    library = new DesignSystemLibrary({ root: path.join(dir, 'library'), builtinRoot });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads three read-only builtins lazily with runnable component previews', async () => {
    const systems = await library.list();
    expect(systems.filter((s) => s.builtin).map((s) => s.id)).toEqual([
      'builtin:ibm',
      'builtin:vercel',
      'builtin:stripe',
    ]);
    const detail = await library.get('builtin:ibm');
    expect(detail.previewSource).toContain('ReactDOM.createRoot');
    expect(detail.previewSource).toContain('data-design-system');
    await expect(library.update('builtin:ibm', { name: 'Changed' })).rejects.toThrow();
    await expect(library.remove('builtin:ibm')).rejects.toThrow();
  });

  it('creates a resumable draft and preserves state across restarts', async () => {
    const created = await library.create({ name: 'My studio', description: 'Calm UI' });
    expect(created.system.status).toBe('draft');
    expect(created.designMd).toContain('My studio');
    await library.update(created.system.id, { sessionDesignId: 'session-one' });
    const restarted = new DesignSystemLibrary({
      root: path.join(dir, 'library'),
      builtinRoot: path.join(dir, 'brands'),
    });
    expect((await restarted.get(created.system.id)).system.sessionDesignId).toBe('session-one');
  });

  it('forks independently, retaining provenance but not session history', async () => {
    const fork = await library.fork('builtin:stripe', 'My stripe');
    expect(fork.system.builtin).toBe(false);
    expect(fork.system.source.systemId).toBe('builtin:stripe');
    expect(fork.system.sessionDesignId).toBeNull();
    await writeFile(
      path.join(fork.system.workspacePath, 'DESIGN.md'),
      VALID.replace('#0055aa', '#ff0000'),
    );
    expect((await library.get('builtin:stripe')).designMd).toContain('#0055aa');
  });

  it('imports invalid markdown as a repairable draft without modifying the source', async () => {
    const source = path.join(dir, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'DESIGN.md'), '# incomplete');
    const imported = await library.importFile(path.join(source, 'DESIGN.md'), 'Imported');
    expect(imported.system.status).toBe('draft');
    expect(imported.system.issues.length).toBeGreaterThan(0);
    expect(await readFile(path.join(source, 'DESIGN.md'), 'utf8')).toBe('# incomplete');
  });

  it('copies referenced assets but never sample source or session metadata into a design', async () => {
    const source = path.join(dir, 'source');
    await mkdir(path.join(source, 'assets'), { recursive: true });
    await writeFile(path.join(source, 'assets', 'logo.svg'), '<svg/>');
    await writeFile(path.join(source, 'DESIGN.md'), `${VALID}\n![Logo](assets/logo.svg)`);
    const imported = await library.importFile(path.join(source, 'DESIGN.md'), 'Assets');
    await library.recordValidation(
      imported.system.id,
      imported.fingerprint,
      [],
      'data:image/png;base64,eA==',
    );
    const destination = path.join(dir, 'design');
    await mkdir(destination);
    await library.apply(imported.system.id, destination);
    expect(await readFile(path.join(destination, 'assets', 'logo.svg'), 'utf8')).toBe('<svg/>');
    await expect(readFile(path.join(destination, 'App.jsx'))).rejects.toThrow();
    await library.remove(imported.system.id);
    expect(await readFile(path.join(destination, 'DESIGN.md'), 'utf8')).toContain(
      'assets/logo.svg',
    );
  });

  it('never overwrites existing destination files and leaves no partial copies on conflicts', async () => {
    const personal = await library.fork('builtin:vercel', 'Local');
    await library.recordValidation(personal.system.id, personal.fingerprint, []);
    const destination = path.join(dir, 'design');
    await mkdir(destination);
    await writeFile(path.join(destination, 'DESIGN.md'), 'Keep me');
    await expect(library.apply(personal.system.id, destination)).rejects.toThrow();
    expect(await readFile(path.join(destination, 'DESIGN.md'), 'utf8')).toBe('Keep me');
  });

  it('invalidates readiness when the specification or preview changes', async () => {
    const personal = await library.fork('builtin:ibm', 'Local');
    await library.recordValidation(personal.system.id, personal.fingerprint, []);
    expect((await library.get(personal.system.id)).system.status).toBe('ready');
    await writeFile(path.join(personal.system.workspacePath, 'App.jsx'), 'broken');
    expect((await library.get(personal.system.id)).system.status).toBe('draft');
    await expect(library.apply(personal.system.id, path.join(dir, 'target'))).rejects.toThrow();
    await expect(
      library.recordValidation(personal.system.id, personal.fingerprint, []),
    ).rejects.toThrow();
  });

  it('keeps failed validation unavailable and never copies unrelated workspace files', async () => {
    const personal = await library.fork('builtin:ibm', 'Local');
    await library.recordValidation(personal.system.id, personal.fingerprint, ['Runtime failed']);
    expect((await library.get(personal.system.id)).system.status).toBe('draft');
    const destination = path.join(dir, 'design');
    await mkdir(destination);
    await expect(library.apply(personal.system.id, destination)).rejects.toThrow();
    await library.recordValidation(personal.system.id, personal.fingerprint, []);
    await writeFile(path.join(personal.system.workspacePath, 'MEMORY.md'), 'private');
    await library.apply(personal.system.id, destination);
    await expect(readFile(path.join(destination, 'MEMORY.md'))).rejects.toThrow();
  });

  it('rejects managed directory junctions without touching external files', async () => {
    const personal = await library.create({ name: 'Local' });
    const outside = path.join(dir, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'system.json'), '{}');
    await rm(personal.system.workspacePath, { recursive: true });
    await symlink(outside, personal.system.workspacePath, 'junction');
    await expect(library.get(personal.system.id)).rejects.toThrow();
    await expect(library.remove(personal.system.id)).rejects.toThrow();
    expect(await readFile(path.join(outside, 'system.json'), 'utf8')).toBe('{}');
  });

  it('rejects traversal ids and external asset references', async () => {
    await expect(library.get('../escape')).rejects.toThrow();
    const source = path.join(dir, 'source');
    await mkdir(source);
    await writeFile(path.join(dir, 'secret.svg'), '<svg/>');
    await writeFile(path.join(source, 'DESIGN.md'), `${VALID}\n![Secret](../secret.svg)`);
    await expect(library.importFile(path.join(source, 'DESIGN.md'), 'Unsafe')).rejects.toThrow();
  });

  it('keeps a system with missing resources visible and repairable', async () => {
    const created = await library.create({ name: 'Interrupted' });
    await writeFile(
      path.join(created.system.workspacePath, 'DESIGN.md'),
      `${VALID}\n![Logo](assets/missing.svg)`,
    );
    const broken = await library.get(created.system.id);
    expect(broken.system.status).toBe('draft');
    expect(broken.system.issues.join(' ')).toContain('missing.svg');
    expect((await library.list()).some((s) => s.id === created.system.id)).toBe(true);
    await library.remove(created.system.id);
    expect((await library.list()).some((s) => s.id === created.system.id)).toBe(false);
  });

  it('forks local sample resources without copying them into unrelated new designs', async () => {
    const created = await library.create({ name: 'Sample assets' });
    await mkdir(path.join(created.system.workspacePath, 'assets'));
    await writeFile(path.join(created.system.workspacePath, 'assets', 'sample.svg'), '<svg/>');
    await writeFile(
      path.join(created.system.workspacePath, 'App.jsx'),
      `${created.previewSource}\n// sample: <img src="assets/sample.svg"/>`,
    );
    const forked = await library.fork(created.system.id);
    expect(
      await readFile(path.join(forked.system.workspacePath, 'assets', 'sample.svg'), 'utf8'),
    ).toBe('<svg/>');
    await library.recordValidation(forked.system.id, forked.fingerprint, []);
    const destination = path.join(dir, 'design');
    await mkdir(destination);
    await library.apply(forked.system.id, destination);
    await expect(readFile(path.join(destination, 'assets', 'sample.svg'))).rejects.toThrow();
  });

  it('rejects symlinked resource directories and reports missing resources', async () => {
    const source = path.join(dir, 'source');
    const outside = path.join(dir, 'outside');
    await mkdir(source);
    await mkdir(outside);
    await writeFile(path.join(outside, 'logo.svg'), '<svg/>');
    await symlink(outside, path.join(source, 'assets'), 'junction');
    await writeFile(path.join(source, 'DESIGN.md'), `${VALID}\n![Logo](assets/logo.svg)`);
    await expect(library.importFile(path.join(source, 'DESIGN.md'), 'Linked')).rejects.toThrow();
    await writeFile(path.join(source, 'DESIGN.md'), `${VALID}\n![Logo](missing.svg)`);
    await expect(library.importFile(path.join(source, 'DESIGN.md'), 'Missing')).rejects.toThrow();
  });
});
