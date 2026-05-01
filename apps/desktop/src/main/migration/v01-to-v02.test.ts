import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigration } from './v01-to-v02';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HEADER_DATA_URL = `data:image/png;base64,${PNG_HEADER.toString('base64')}`;

interface FakeDesign {
  id: string;
  name: string;
  slug?: string | null;
}

function makeFakeDb(
  designs: FakeDesign[],
  designFiles: Array<{ design_id: string; path: string; content: string }> = [
    { design_id: 'd-a', path: 'index.html', content: '<h1>A</h1>' },
    { design_id: 'd-a', path: 'assets/hero.png', content: PNG_HEADER_DATA_URL },
  ],
  onClose: () => void = () => {},
  comments: Array<{
    design_id: string;
    kind: string;
    selector: string;
    tag: string;
    text: string;
    status: string;
    created_at: number | string | null;
  }> = [],
) {
  const chatMessages: Array<{
    design_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }> = [
    { design_id: 'd-a', role: 'user', content: 'hi', created_at: 1 },
    { design_id: 'd-a', role: 'assistant', content: 'hello', created_at: 2 },
  ];
  return {
    prepare: (sql: string) => ({
      all: <T>(...params: unknown[]): T[] => {
        if (sql.startsWith('SELECT id, name, slug, created_at FROM designs')) {
          return designs.map((d) => ({
            ...d,
            slug: d.slug ?? null,
            created_at: 0,
          })) as unknown as T[];
        }
        if (sql.startsWith('SELECT design_id, path, content FROM design_files')) {
          return designFiles.filter((f) => f.design_id === params[0]) as unknown as T[];
        }
        if (sql.startsWith('SELECT design_id, role, content, created_at FROM chat_messages')) {
          return chatMessages.filter((m) => m.design_id === params[0]) as unknown as T[];
        }
        if (
          sql.startsWith(
            'SELECT design_id, kind, selector, tag, text, status, created_at FROM comments',
          )
        ) {
          return comments.filter((m) => m.design_id === params[0]) as unknown as T[];
        }
        return [] as unknown as T[];
      },
    }),
    close: onClose,
  };
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(fullPath));
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

describe('runMigration', () => {
  it('returns zero counts when source DB does not exist', async () => {
    const r = await runMigration({
      sourceDbPath: '/no/such/file.db',
      workspaceRoot: tmpdir(),
      sessionDir: tmpdir(),
    });
    expect(r.attempted).toBe(0);
    expect(r.migrated).toBe(0);
  });

  it('migrates one design end-to-end (in-memory DB stand-in)', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, ''); // existence check only

    try {
      const r = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () => makeFakeDb([{ id: 'd-a', name: 'My Design' }]),
      });
      expect(r.attempted).toBe(1);
      expect(r.migrated).toBe(1);
      expect(r.failed).toEqual([]);
      expect(existsSync(path.join(wsroot, 'my-design', 'index.html'))).toBe(true);
      expect(readFileSync(path.join(wsroot, 'my-design', 'assets/hero.png'))).toEqual(PNG_HEADER);
      const sessionEntries = listFilesRecursive(sessionDir).flatMap((file) =>
        readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type?: string; message?: unknown }),
      );
      const messageEntries = sessionEntries.filter(
        (entry): entry is { type: 'message'; message: { role: string; content: unknown } } =>
          entry.type === 'message' &&
          typeof entry.message === 'object' &&
          entry.message !== null &&
          'role' in entry.message,
      );
      expect(messageEntries.map((entry) => entry.message.role)).toEqual(['user', 'assistant']);
      expect(messageEntries[0]?.message.content).toBe('hi');
      expect(messageEntries[1]?.message.content).toEqual([{ type: 'text', text: 'hello' }]);
      expect(r.backupPath?.endsWith('.v0.1.backup')).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('fails a design instead of writing legacy file paths outside the workspace', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-path-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');

    try {
      const r = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () =>
          makeFakeDb(
            [{ id: 'd-a', name: 'Unsafe Path' }],
            [{ design_id: 'd-a', path: '../escaped.txt', content: 'escape' }],
          ),
      });
      expect(r.attempted).toBe(1);
      expect(r.migrated).toBe(0);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0]?.reason).toMatch(/invalid path segment|Invalid legacy design file path/);
      expect(existsSync(path.join(wsroot, 'unsafe-path'))).toBe(false);
      expect(existsSync(path.join(wsroot, 'escaped.txt'))).toBe(false);
      expect(existsSync(path.join(tmpRoot, 'escaped.txt'))).toBe(false);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('fails a design with an unsafe stored slug instead of escaping the workspace root', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-slug-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');

    try {
      const r = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () => makeFakeDb([{ id: 'd-a', name: 'Unsafe Slug', slug: '../escaped' }]),
      });
      expect(r.attempted).toBe(1);
      expect(r.migrated).toBe(0);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0]?.reason).toContain('Invalid legacy design slug');
      expect(existsSync(path.join(tmpRoot, 'escaped'))).toBe(false);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('allocates distinct workspaces when migrated designs resolve to the same slug', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-unique-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');

    try {
      const r = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () =>
          makeFakeDb(
            [
              { id: 'd-a', name: 'Same Name', slug: null },
              { id: 'd-b', name: 'Same Name', slug: null },
            ],
            [
              { design_id: 'd-a', path: 'index.html', content: '<h1>A</h1>' },
              { design_id: 'd-b', path: 'index.html', content: '<h1>B</h1>' },
            ],
          ),
      });
      expect(r.attempted).toBe(2);
      expect(r.migrated).toBe(2);
      expect(r.failed).toEqual([]);
      expect(readFileSync(path.join(wsroot, 'same-name', 'index.html'), 'utf8')).toBe('<h1>A</h1>');
      expect(readFileSync(path.join(wsroot, 'same-name-2', 'index.html'), 'utf8')).toBe(
        '<h1>B</h1>',
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('closes the legacy database before renaming it to a backup', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-close-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');
    let closed = false;

    try {
      await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () =>
          makeFakeDb([{ id: 'd-a', name: 'Close Order' }], undefined, () => {
            closed = true;
          }),
        onProgress: (event) => {
          if (event.phase === 'complete') expect(closed).toBe(true);
        },
      });

      expect(closed).toBe(true);
      expect(existsSync(`${fakeDbPath}.v0.1.backup`)).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('allocates a unique backup name when the default migration backup exists', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-backup-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');
    writeFileSync(`${fakeDbPath}.v0.1.backup`, 'old backup');

    try {
      const result = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () => makeFakeDb([{ id: 'd-a', name: 'Backup Exists' }]),
      });

      expect(result.backupPath).toBe(`${fakeDbPath}.v0.1.backup.2`);
      const backupPath = result.backupPath;
      if (backupPath === undefined) throw new Error('expected migration backup path');
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(`${fakeDbPath}.v0.1.backup`, 'utf8')).toBe('old backup');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('migrates files and chat when an earlier v0.1 database has no comments table', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-no-comments-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');

    try {
      const db = makeFakeDb([{ id: 'd-a', name: 'No Comments Table' }]);
      const result = await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () => ({
          ...db,
          prepare: (sql: string) => {
            if (sql.includes('FROM comments')) {
              throw new Error('SQLITE_ERROR: no such table: comments');
            }
            return db.prepare(sql);
          },
        }),
      });

      expect(result.migrated).toBe(1);
      expect(result.failed).toEqual([]);
      expect(existsSync(path.join(wsroot, 'no-comments-table', 'index.html'))).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('migrates legacy inline comments into the session timeline', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'codesign-migration-comments-'));
    const wsroot = path.join(tmpRoot, 'workspaces');
    const sessionDir = path.join(tmpRoot, 'sessions');
    const fakeDbPath = path.join(tmpRoot, 'designs.db');
    writeFileSync(fakeDbPath, '');

    try {
      await runMigration({
        sourceDbPath: fakeDbPath,
        workspaceRoot: wsroot,
        sessionDir,
        openDatabase: () =>
          makeFakeDb([{ id: 'd-a', name: 'Commented' }], undefined, undefined, [
            {
              design_id: 'd-a',
              kind: 'edit',
              selector: '.hero-title',
              tag: 'h1',
              text: 'Make this calmer.',
              status: 'pending',
              created_at: 1.5,
            },
          ]),
      });

      const sessionEntries = listFilesRecursive(sessionDir).flatMap((file) =>
        readFileSync(file, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type?: string; message?: unknown }),
      );
      const userMessages = sessionEntries.filter(
        (entry): entry is { type: 'message'; message: { role: string; content: unknown } } =>
          entry.type === 'message' &&
          typeof entry.message === 'object' &&
          entry.message !== null &&
          'role' in entry.message &&
          entry.message.role === 'user',
      );

      expect(userMessages).toHaveLength(2);
      expect(userMessages[1]?.message.content).toEqual([
        {
          type: 'text',
          text: [
            'Legacy inline comment migrated from Open CoDesign v0.1.',
            'Kind: edit',
            'Status: pending',
            'Selector: .hero-title',
            'Element: <h1>',
            '',
            'Comment: Make this calmer.',
          ].join('\n'),
        },
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
