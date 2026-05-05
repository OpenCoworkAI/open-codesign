import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  Design,
  DesignFile,
  DesignSnapshot,
  DiagnosticEventInput,
  DiagnosticEventRow,
  DiagnosticLevel,
  SnapshotCreateInput,
} from '@open-codesign/shared';
import { assertWorkspacePath } from './workspace-path';

interface StoreData {
  schemaVersion: 1;
  designs: Design[];
  snapshots: DesignSnapshot[];
  diagnosticEvents: DiagnosticEventRow[];
}

export interface Database {
  readonly kind: 'json-design-store';
  readonly dataDir: string;
  readonly storePath: string;
  readonly sessionDir: string;
  memoryData?: StoreData;
  close(): void;
}

const EMPTY_STORE: StoreData = {
  schemaVersion: 1,
  designs: [],
  snapshots: [],
  diagnosticEvents: [],
};

const DIAGNOSTIC_DEDUP_WINDOW_MS = 200;

function cloneStore(data: StoreData): StoreData {
  return JSON.parse(JSON.stringify(data)) as StoreData;
}

function emptyStore(): StoreData {
  return cloneStore(EMPTY_STORE);
}

function normalizeStorePath(inputPath: string): string {
  if (path.extname(inputPath) === '.json') return inputPath;
  return path.join(path.dirname(inputPath), 'design-store.json');
}

export function initSnapshotsDb(inputPath: string): Database {
  const storePath = normalizeStorePath(inputPath);
  const dataDir = path.dirname(storePath);
  mkdirSync(dataDir, { recursive: true });
  return {
    kind: 'json-design-store',
    dataDir,
    storePath,
    sessionDir: path.join(dataDir, 'sessions'),
    close: () => {},
  };
}

export function safeInitSnapshotsDb(
  inputPath: string,
): { ok: true; db: Database } | { ok: false; error: Error } {
  try {
    const db = initSnapshotsDb(inputPath);
    readStore(db);
    return { ok: true, db };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { ok: false, error };
  }
}

export function initInMemoryDb(): Database {
  return {
    kind: 'json-design-store',
    dataDir: ':memory:',
    storePath: ':memory:',
    sessionDir: ':memory:/sessions',
    memoryData: emptyStore(),
    close: () => {},
  };
}

function readStore(db: Database): StoreData {
  if (db.memoryData !== undefined) return cloneStore(db.memoryData);
  if (!existsSync(db.storePath)) return emptyStore();
  const parsed = JSON.parse(readFileSync(db.storePath, 'utf8')) as Partial<StoreData>;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported design store schemaVersion: ${String(parsed.schemaVersion)}`);
  }
  return {
    schemaVersion: 1,
    designs: Array.isArray(parsed.designs) ? (parsed.designs as Design[]) : [],
    snapshots: Array.isArray(parsed.snapshots) ? (parsed.snapshots as DesignSnapshot[]) : [],
    diagnosticEvents: Array.isArray(parsed.diagnosticEvents)
      ? (parsed.diagnosticEvents as DiagnosticEventRow[])
      : [],
  };
}

function writeStore(db: Database, data: StoreData): void {
  if (db.memoryData !== undefined) {
    db.memoryData = cloneStore(data);
    return;
  }
  mkdirSync(path.dirname(db.storePath), { recursive: true });
  const tmp = `${db.storePath}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, db.storePath);
}

function mutateStore<T>(db: Database, fn: (data: StoreData) => T): T {
  const data = readStore(db);
  const result = fn(data);
  writeStore(db, data);
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mimeTypeForAssetPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (!lower.startsWith('assets/')) return null;
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

function readWorkspaceContentForStore(abs: string, filePath: string): string {
  const mimeType = mimeTypeForAssetPath(filePath);
  if (mimeType !== null) {
    return `data:${mimeType};base64,${readFileSync(abs).toString('base64')}`;
  }
  return readFileSync(abs, 'utf8');
}

function requireDesignIndex(data: StoreData, id: string): number {
  const idx = data.designs.findIndex((design) => design.id === id);
  if (idx < 0) throw new Error(`Design not found: ${id}`);
  return idx;
}

export function createDesign(db: Database, name = 'Untitled design'): Design {
  return mutateStore(db, (data) => {
    const now = nowIso();
    const design: Design = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      thumbnailText: null,
      deletedAt: null,
      workspacePath: null,
    };
    data.designs.push(design);
    return design;
  });
}

export function getDesign(db: Database, id: string): Design | null {
  return readStore(db).designs.find((design) => design.id === id) ?? null;
}

export function listDesigns(db: Database): Design[] {
  return readStore(db)
    .designs.filter((design) => design.deletedAt === null)
    .sort((a, b) => {
      const updated = b.updatedAt.localeCompare(a.updatedAt);
      return updated !== 0 ? updated : b.createdAt.localeCompare(a.createdAt);
    });
}

export function touchDesignActivity(
  db: Database,
  id: string,
  updatedAt: string = nowIso(),
): Design | null {
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const nextUpdatedAt = updatedAt > current.updatedAt ? updatedAt : current.updatedAt;
    const updated: Design = { ...current, updatedAt: nextUpdatedAt };
    data.designs[idx] = updated;
    return updated;
  });
}

export function renameDesign(db: Database, id: string, name: string): Design | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Design name must not be empty');
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = { ...current, name: trimmed, updatedAt: nowIso() };
    data.designs[idx] = updated;
    return updated;
  });
}

export function setDesignThumbnail(
  db: Database,
  id: string,
  thumbnailText: string | null,
): Design | null {
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = { ...current, thumbnailText };
    data.designs[idx] = updated;
    return updated;
  });
}

export function softDeleteDesign(db: Database, id: string): Design | null {
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = { ...current, deletedAt: nowIso() };
    data.designs[idx] = updated;
    return updated;
  });
}

export function deleteDesignForRollback(db: Database, id: string): boolean {
  return mutateStore(db, (data) => {
    const before = data.designs.length;
    data.designs = data.designs.filter((design) => design.id !== id);
    data.snapshots = data.snapshots.filter((snapshot) => snapshot.designId !== id);
    return data.designs.length < before;
  });
}

export function updateDesignWorkspace(
  db: Database,
  id: string,
  workspacePath: string,
): Design | null {
  const checkedWorkspacePath = assertWorkspacePath(workspacePath);
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = {
      ...current,
      workspacePath: checkedWorkspacePath,
      updatedAt: nowIso(),
    };
    data.designs[idx] = updated;
    return updated;
  });
}

export function clearDesignWorkspace(db: Database, id: string): Design | null {
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = { ...current, workspacePath: null, updatedAt: nowIso() };
    data.designs[idx] = updated;
    return updated;
  });
}

export function __unsafeSetDesignWorkspaceForTest(
  db: Database,
  id: string,
  workspacePath: string | null,
): Design | null {
  return mutateStore(db, (data) => {
    const idx = data.designs.findIndex((design) => design.id === id);
    if (idx < 0) return null;
    const current = data.designs[idx];
    if (current === undefined) return null;
    const updated: Design = { ...current, workspacePath, updatedAt: nowIso() };
    data.designs[idx] = updated;
    return updated;
  });
}

export function duplicateDesign(db: Database, sourceId: string, newName: string): Design | null {
  return mutateStore(db, (data) => {
    const source = data.designs.find((design) => design.id === sourceId);
    if (source === undefined) return null;
    const newId = crypto.randomUUID();
    const now = nowIso();
    const trimmed = newName.trim() || `${source.name} copy`;
    const cloned: Design = {
      schemaVersion: 1,
      id: newId,
      name: trimmed,
      createdAt: now,
      updatedAt: now,
      thumbnailText: source.thumbnailText,
      deletedAt: null,
      workspacePath: null,
    };
    data.designs.push(cloned);

    const idMap = new Map<string, string>();
    for (const snapshot of data.snapshots
      .filter((candidate) => candidate.designId === sourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const cloneId = crypto.randomUUID();
      idMap.set(snapshot.id, cloneId);
      data.snapshots.push({
        ...snapshot,
        id: cloneId,
        designId: newId,
        parentId: snapshot.parentId !== null ? (idMap.get(snapshot.parentId) ?? null) : null,
      });
    }
    return cloned;
  });
}

export function createSnapshot(db: Database, input: SnapshotCreateInput): DesignSnapshot {
  return mutateStore(db, (data) => {
    requireDesignIndex(data, input.designId);
    const now = nowIso();
    const snapshot: DesignSnapshot = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      designId: input.designId,
      parentId: input.parentId,
      type: input.type,
      prompt: input.prompt,
      artifactType: input.artifactType,
      artifactSource: input.artifactSource,
      createdAt: now,
      ...(input.message !== undefined ? { message: input.message } : {}),
    };
    data.snapshots.push(snapshot);
    const designIdx = requireDesignIndex(data, input.designId);
    const design = data.designs[designIdx];
    if (design === undefined) throw new Error(`Design not found: ${input.designId}`);
    data.designs[designIdx] = { ...design, updatedAt: now };
    return snapshot;
  });
}

export function listSnapshots(db: Database, designId: string): DesignSnapshot[] {
  return readStore(db)
    .snapshots.filter((snapshot) => snapshot.designId === designId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSnapshot(db: Database, id: string): DesignSnapshot | null {
  return readStore(db).snapshots.find((snapshot) => snapshot.id === id) ?? null;
}

export function deleteSnapshot(db: Database, id: string): void {
  mutateStore(db, (data) => {
    data.snapshots = data.snapshots.filter((snapshot) => snapshot.id !== id);
  });
}

export function normalizeDesignFilePath(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) throw new Error('path must not be empty');
  if (s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s)) {
    throw new Error(`path must be relative: ${raw}`);
  }
  const parts = s.replaceAll('\\', '/').split('/');
  for (const part of parts) {
    if (part === '..' || part === '') throw new Error(`invalid path segment in ${raw}`);
  }
  return parts.join('/');
}

export function listDesignFiles(_db: Database, _designId: string): DesignFile[] {
  const design = getDesign(_db, _designId);
  if (design?.workspacePath === null || design?.workspacePath === undefined) return [];
  const out: DesignFile[] = [];
  const root = path.resolve(design.workspacePath);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.codesign') {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizeDesignFilePath(path.relative(root, abs));
      const s = statSync(abs);
      out.push({
        schemaVersion: 1,
        id: `${_designId}:${rel}`,
        designId: _designId,
        path: rel,
        content: readWorkspaceContentForStore(abs, rel),
        createdAt: s.birthtime.toISOString(),
        updatedAt: s.mtime.toISOString(),
      });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function viewDesignFile(
  db: Database,
  designId: string,
  filePath: string,
): DesignFile | null {
  const design = getDesign(db, designId);
  if (design?.workspacePath === null || design?.workspacePath === undefined) return null;
  const normalizedPath = normalizeDesignFilePath(filePath);
  const root = path.resolve(design.workspacePath);
  const abs = path.resolve(root, normalizedPath);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  if (!existsSync(abs)) return null;
  const s = statSync(abs);
  if (!s.isFile()) return null;
  return {
    schemaVersion: 1,
    id: `${designId}:${normalizedPath}`,
    designId,
    path: normalizedPath,
    content: readWorkspaceContentForStore(abs, normalizedPath),
    createdAt: s.birthtime.toISOString(),
    updatedAt: s.mtime.toISOString(),
  };
}

export function createDesignFile(
  db: Database,
  designId: string,
  filePath: string,
  content: string,
): DesignFile {
  return upsertDesignFile(db, designId, filePath, content);
}

export function upsertDesignFile(
  _db: Database,
  designId: string,
  filePath: string,
  content: string,
): DesignFile {
  const normalizedPath = normalizeDesignFilePath(filePath);
  const now = nowIso();
  touchDesignActivity(_db, designId, now);
  return {
    schemaVersion: 1,
    id: `${designId}:${normalizedPath}`,
    designId,
    path: normalizedPath,
    content,
    createdAt: now,
    updatedAt: now,
  };
}

function rowToDiagnosticEvent(row: DiagnosticEventRow): DiagnosticEventRow {
  return {
    id: row.id,
    schemaVersion: 1,
    ts: row.ts,
    level: row.level as DiagnosticLevel,
    code: row.code,
    scope: row.scope,
    runId: row.runId,
    fingerprint: row.fingerprint,
    message: row.message,
    stack: row.stack,
    transient: row.transient,
    count: row.count,
    context: row.context,
  };
}

export function recordDiagnosticEvent(
  db: Database,
  input: DiagnosticEventInput,
  now: () => number = Date.now,
): number {
  return mutateStore(db, (data) => {
    const ts = now();
    const recent = data.diagnosticEvents
      .filter(
        (event) =>
          event.fingerprint === input.fingerprint && event.ts > ts - DIAGNOSTIC_DEDUP_WINDOW_MS,
      )
      .sort((a, b) => b.ts - a.ts || b.id - a.id)[0];
    if (recent !== undefined) {
      const idx = data.diagnosticEvents.findIndex((event) => event.id === recent.id);
      if (idx >= 0) {
        const current = data.diagnosticEvents[idx];
        if (current === undefined) return recent.id;
        data.diagnosticEvents[idx] = {
          ...current,
          ts,
          transient: current.transient || input.transient,
          count: current.count + 1,
        };
      }
      return recent.id;
    }

    const id =
      data.diagnosticEvents.reduce((max, event) => (event.id > max ? event.id : max), 0) + 1;
    data.diagnosticEvents.push({
      id,
      schemaVersion: 1,
      ts,
      level: input.level,
      code: input.code,
      scope: input.scope,
      runId: input.runId,
      fingerprint: input.fingerprint,
      message: input.message,
      stack: input.stack,
      transient: input.transient,
      count: 1,
      context: input.context,
    });
    return id;
  });
}

export function getDiagnosticEventById(db: Database, id: number): DiagnosticEventRow | undefined {
  const row = readStore(db).diagnosticEvents.find((event) => event.id === id);
  return row === undefined ? undefined : rowToDiagnosticEvent(row);
}

export function listDiagnosticEvents(
  db: Database,
  opts?: { limit?: number; includeTransient?: boolean },
): DiagnosticEventRow[] {
  const limit = opts?.limit ?? 100;
  const includeTransient = opts?.includeTransient ?? false;
  return readStore(db)
    .diagnosticEvents.filter((event) => includeTransient || !event.transient)
    .sort((a, b) => b.ts - a.ts || b.id - a.id)
    .slice(0, limit)
    .map(rowToDiagnosticEvent);
}

export function pruneDiagnosticEvents(db: Database, maxRows: number): number {
  return mutateStore(db, (data) => {
    const keep = new Set(
      data.diagnosticEvents
        .slice()
        .sort((a, b) => b.ts - a.ts || b.id - a.id)
        .slice(0, maxRows)
        .map((event) => event.id),
    );
    const before = data.diagnosticEvents.length;
    data.diagnosticEvents = data.diagnosticEvents.filter((event) => keep.has(event.id));
    return before - data.diagnosticEvents.length;
  });
}
