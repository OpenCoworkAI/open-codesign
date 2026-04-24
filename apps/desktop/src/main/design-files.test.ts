/**
 * Unit tests for design_files helpers in snapshots-db.ts.
 *
 * Runs against an in-memory SQLite — no filesystem, no Electron.
 */

import { describe, expect, it } from 'vitest';
import {
  createDesign,
  createDesignFile,
  initInMemoryDb,
  insertInDesignFile,
  listDesignFiles,
  listDesignFilesInDir,
  normalizeDesignFilePath,
  strReplaceInDesignFile,
  upsertDesignFile,
  viewDesignFile,
} from './snapshots-db';

function seed() {
  const db = initInMemoryDb();
  const design = createDesign(db, 'Test');
  return { db, designId: design.id };
}

describe('normalizeDesignFilePath', () => {
  it('accepts simple relative paths', () => {
    expect(normalizeDesignFilePath('index.html')).toBe('index.html');
    expect(normalizeDesignFilePath('a/b/c.txt')).toBe('a/b/c.txt');
  });
  it('normalizes backslashes', () => {
    expect(normalizeDesignFilePath('a\\b\\c')).toBe('a/b/c');
  });
  it('rejects absolute paths', () => {
    expect(() => normalizeDesignFilePath('/etc/passwd')).toThrow();
    expect(() => normalizeDesignFilePath('C:/tmp/x')).toThrow();
  });
  it('rejects traversal', () => {
    expect(() => normalizeDesignFilePath('../foo')).toThrow();
    expect(() => normalizeDesignFilePath('a//b')).toThrow();
  });
});

describe('create + view', () => {
  it('creates a file and reads it back', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'index.html', '<html></html>');
    const f = viewDesignFile(db, designId, 'index.html');
    expect(f?.content).toBe('<html></html>');
  });
  it('rejects duplicate create', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.html', 'v1');
    expect(() => createDesignFile(db, designId, 'a.html', 'v2')).toThrow(/already exists/);
  });
  it('returns null when missing', () => {
    const { db, designId } = seed();
    expect(viewDesignFile(db, designId, 'missing.txt')).toBeNull();
  });
});

describe('str_replace', () => {
  it('replaces a unique occurrence', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.html', 'hello world');
    const f = strReplaceInDesignFile(db, designId, 'a.html', 'world', 'there');
    expect(f.content).toBe('hello there');
  });
  it('rejects no match', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.html', 'hello');
    expect(() => strReplaceInDesignFile(db, designId, 'a.html', 'xyz', 'abc')).toThrow(/not found/);
  });
  it('rejects multiple matches', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.html', 'foo foo');
    expect(() => strReplaceInDesignFile(db, designId, 'a.html', 'foo', 'bar')).toThrow(
      /matched 2 times/,
    );
  });
});

describe('insert', () => {
  it('inserts at given line', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.txt', 'line0\nline1\nline2');
    const f = insertInDesignFile(db, designId, 'a.txt', 1, 'NEW');
    expect(f.content).toBe('line0\nNEW\nline1\nline2');
  });
  it('inserts at end', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.txt', 'line0');
    const f = insertInDesignFile(db, designId, 'a.txt', 1, 'tail');
    expect(f.content).toBe('line0\ntail');
  });
  it('rejects out-of-range line', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'a.txt', 'x');
    expect(() => insertInDesignFile(db, designId, 'a.txt', 99, 'y')).toThrow(/out of range/);
  });
});

describe('upsert', () => {
  it('creates a missing design file', () => {
    const { db, designId } = seed();

    const file = upsertDesignFile(db, designId, 'nested\\index.html', '<main>first</main>');

    expect(file.path).toBe('nested/index.html');
    expect(file.content).toBe('<main>first</main>');
    expect(viewDesignFile(db, designId, 'nested/index.html')?.content).toBe('<main>first</main>');
  });

  it('updates an existing design file in place', () => {
    const { db, designId } = seed();
    const created = createDesignFile(db, designId, 'index.html', '<main>before</main>');

    const updated = upsertDesignFile(db, designId, 'index.html', '<main>after</main>');

    expect(updated.id).toBe(created.id);
    expect(updated.content).toBe('<main>after</main>');
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    expect(viewDesignFile(db, designId, 'index.html')?.content).toBe('<main>after</main>');
  });
});

describe('list', () => {
  it('lists files by design', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'b.html', '');
    createDesignFile(db, designId, 'a.html', '');
    const names = listDesignFiles(db, designId).map((f) => f.path);
    expect(names).toEqual(['a.html', 'b.html']);
  });
  it('lists entries within a directory', () => {
    const { db, designId } = seed();
    createDesignFile(db, designId, 'assets/a.png', '');
    createDesignFile(db, designId, 'assets/b.png', '');
    createDesignFile(db, designId, 'index.html', '');
    expect(listDesignFilesInDir(db, designId, 'assets')).toEqual(['a.png', 'b.png']);
    expect(listDesignFilesInDir(db, designId, '')).toEqual(['assets', 'index.html']);
  });
});
