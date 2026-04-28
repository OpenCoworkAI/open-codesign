import type { DesignFile } from '@open-codesign/shared';
import type { Database } from './native-binding';

// ---------------------------------------------------------------------------
// Virtual FS — design_files (Workstream E Phase 2)
//
// Paths are stored verbatim. Callers MUST pass POSIX-relative paths that were
// already validated via normalizeDesignFilePath(); this helper throws for
// absolute paths and ".." traversal so tool implementations don't have to
// repeat the check.
// ---------------------------------------------------------------------------

interface DesignFileRowDb {
  id: string;
  design_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToDesignFile(row: DesignFileRowDb): DesignFile {
  return {
    schemaVersion: 1,
    id: row.id,
    designId: row.design_id,
    path: normalizeDesignFilePath(row.path),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reject absolute paths, drive letters, "..", and empty segments. Returns
 * the cleaned POSIX path on success.
 */
export function normalizeDesignFilePath(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) throw new Error('path must not be empty');
  if (s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s))
    throw new Error(`path must be relative: ${raw}`);
  const parts = s.replaceAll('\\', '/').split('/');
  for (const p of parts) {
    if (p === '..' || p === '') throw new Error(`invalid path segment in ${raw}`);
  }
  return parts.join('/');
}

export function viewDesignFile(db: Database, designId: string, path: string): DesignFile | null {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  return row ? rowToDesignFile(row) : null;
}

export function listDesignFiles(db: Database, designId: string): DesignFile[] {
  return (
    db
      .prepare('SELECT * FROM design_files WHERE design_id = ? ORDER BY path ASC')
      .all(designId) as DesignFileRowDb[]
  ).map(rowToDesignFile);
}

/**
 * List files whose path matches `${dir}/*` (one segment deeper only). Used by
 * the workspace edit tool's `view` command when the caller points at a directory.
 */
export function listDesignFilesInDir(db: Database, designId: string, dir: string): string[] {
  const clean = dir === '' || dir === '.' ? '' : normalizeDesignFilePath(dir);
  const prefix = clean.length === 0 ? '' : `${clean}/`;
  const files = listDesignFiles(db, designId);
  const names = new Set<string>();
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const first = rest.split('/')[0] ?? rest;
    names.add(first);
  }
  return [...names].sort();
}

export function createDesignFile(
  db: Database,
  designId: string,
  path: string,
  content: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const existing = db
    .prepare('SELECT 1 FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p);
  if (existing) throw new Error(`File already exists: ${p}`);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, designId, p, content, now, now);
  const row = db.prepare('SELECT * FROM design_files WHERE id = ?').get(id) as DesignFileRowDb;
  return rowToDesignFile(row);
}

export function upsertDesignFile(
  db: Database,
  designId: string,
  path: string,
  content: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const existing = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (existing) {
    const now = new Date().toISOString();
    db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
      content,
      now,
      existing.id,
    );
    return rowToDesignFile({ ...existing, content, updated_at: now });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO design_files (id, design_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, designId, p, content, now, now);
  return rowToDesignFile(
    db.prepare('SELECT * FROM design_files WHERE id = ?').get(id) as DesignFileRowDb,
  );
}

export function strReplaceInDesignFile(
  db: Database,
  designId: string,
  path: string,
  oldStr: string,
  newStr: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (!row) throw new Error(`File not found: ${p}`);
  const occurrences = row.content.split(oldStr).length - 1;
  if (occurrences === 0) throw new Error(`old_str not found in ${p}`);
  if (occurrences > 1)
    throw new Error(`old_str matched ${occurrences} times in ${p}; must be unique`);
  const next = row.content.replace(oldStr, newStr);
  const now = new Date().toISOString();
  db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
    next,
    now,
    row.id,
  );
  return rowToDesignFile({ ...row, content: next, updated_at: now });
}

export function insertInDesignFile(
  db: Database,
  designId: string,
  path: string,
  line: number,
  text: string,
): DesignFile {
  const p = normalizeDesignFilePath(path);
  const row = db
    .prepare('SELECT * FROM design_files WHERE design_id = ? AND path = ?')
    .get(designId, p) as DesignFileRowDb | undefined;
  if (!row) throw new Error(`File not found: ${p}`);
  const lines = row.content.split('\n');
  if (line < 0 || line > lines.length)
    throw new Error(`insert_line ${line} out of range (0..${lines.length}) for ${p}`);
  const insertion = text.endsWith('\n') ? text.slice(0, -1) : text;
  lines.splice(line, 0, insertion);
  const next = lines.join('\n');
  const now = new Date().toISOString();
  db.prepare('UPDATE design_files SET content = ?, updated_at = ? WHERE id = ?').run(
    next,
    now,
    row.id,
  );
  return rowToDesignFile({ ...row, content: next, updated_at: now });
}
