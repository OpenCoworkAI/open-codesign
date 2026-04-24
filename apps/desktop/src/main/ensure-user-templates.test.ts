import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserTemplates, resolveBundledTemplatesDir } from './ensure-user-templates';

describe('ensureUserTemplates', () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `codesign-seed-${process.pid}-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('seeds templates into userData when destination is missing', async () => {
    const source = path.join(root, 'bundle', 'templates');
    mkdirSync(path.join(source, 'scaffolds'), { recursive: true });
    mkdirSync(path.join(source, 'skills'), { recursive: true });
    writeFileSync(path.join(source, 'scaffolds', 'manifest.json'), '{"schemaVersion":1}');
    writeFileSync(path.join(source, 'skills', 'x.md'), 'body');

    const userData = path.join(root, 'user');
    mkdirSync(userData, { recursive: true });

    const result = await ensureUserTemplates(userData, source);
    expect(result.action).toBe('seeded');
    expect(
      readFileSync(path.join(userData, 'templates', 'scaffolds', 'manifest.json'), 'utf8'),
    ).toContain('schemaVersion');
    expect(readFileSync(path.join(userData, 'templates', 'skills', 'x.md'), 'utf8')).toBe('body');
  });

  it('second invocation is a no-op (user-owned after seed)', async () => {
    const source = path.join(root, 'bundle', 'templates');
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, 'a.txt'), 'bundled');

    const userData = path.join(root, 'user');
    mkdirSync(userData, { recursive: true });

    const first = await ensureUserTemplates(userData, source);
    expect(first.action).toBe('seeded');

    // User edits the seeded copy. A second invocation must leave their edit alone.
    writeFileSync(path.join(userData, 'templates', 'a.txt'), 'user-edited');
    const second = await ensureUserTemplates(userData, source);
    expect(second.action).toBe('skipped');
    expect(readFileSync(path.join(userData, 'templates', 'a.txt'), 'utf8')).toBe('user-edited');
  });

  it('reports missing-source when the bundle dir does not exist', async () => {
    const userData = path.join(root, 'user');
    mkdirSync(userData, { recursive: true });
    const result = await ensureUserTemplates(userData, null);
    expect(result.action).toBe('missing-source');
  });
});

describe('resolveBundledTemplatesDir', () => {
  let root: string;

  beforeEach(() => {
    root = path.join(tmpdir(), `codesign-resolve-${process.pid}-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers the production resourcesPath when it exists', () => {
    const prod = path.join(root, 'App.app', 'Contents', 'Resources');
    mkdirSync(path.join(prod, 'templates'), { recursive: true });
    const resolved = resolveBundledTemplatesDir(prod, path.join(root, 'irrelevant.js'));
    expect(resolved).toBe(path.join(prod, 'templates'));
  });

  it('walks up from startFile to find resources/templates in dev', () => {
    const repo = path.join(root, 'repo');
    mkdirSync(path.join(repo, 'resources', 'templates'), { recursive: true });
    const nested = path.join(repo, 'out', 'main', 'index.js');
    mkdirSync(path.dirname(nested), { recursive: true });
    const resolved = resolveBundledTemplatesDir(undefined, nested);
    expect(resolved).toBe(path.join(repo, 'resources', 'templates'));
  });

  it('returns null when neither location has templates', () => {
    const resolved = resolveBundledTemplatesDir(
      path.join(root, 'no-resources'),
      path.join(root, 'sub', 'file.js'),
    );
    expect(resolved).toBeNull();
  });
});
