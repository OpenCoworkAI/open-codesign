import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Message, Usage } from '@mariozechner/pi-ai';
import { SessionManager } from '@open-codesign/core';
import { normalizeDesignFilePath } from '../snapshots-db';
import { prepareWorkspaceWriteContent } from '../workspace-file-content';

/**
 * v0.1 → v0.2 migration (T2.6).
 *
 * Strategy (per docs/v0.2-plan.md §11):
 *   1. Detect `<userData>/designs.db` from v0.1.
 *   2. For each row in `designs`, materialise a workspace under
 *      `<defaultWorkspaceRoot>/<slug>/` and write any `design_files`
 *      rows into the workspace.
 *   3. Translate `chat_messages` rows into a SessionManager-managed
 *      JSONL via `appendUserMessage` / `appendAssistantMessage`.
 *   4. Translate `comments` rows into anchored user-message entries.
 *   5. Rename the source DB to `designs.db.v0.1.backup` so the next
 *      boot doesn't re-prompt.
 *
 * The script is **defensive**: any per-design failure is logged and
 * the loop continues. The user can manually reattempt later.
 */

export interface MigrationOptions {
  /** Absolute path to the v0.1 designs.db (read-only). */
  sourceDbPath: string;
  /** Absolute root where v0.2 workspaces live. */
  workspaceRoot: string;
  /** Absolute directory the SessionManager writes JSONL into. */
  sessionDir: string;
  /** Optional legacy SQLite opener. v0.2 runtime does not bundle a SQLite driver. */
  openDatabase?: (path: string) => MigrationDatabase;
  /** Hook for per-design progress. */
  onProgress?: (event: MigrationProgress) => void;
}

export interface MigrationDatabase {
  prepare(sql: string): { all: <T = unknown>(...params: unknown[]) => T[] };
  close(): void;
}

export interface MigrationProgress {
  phase: 'start' | 'design-start' | 'design-done' | 'design-fail' | 'complete';
  designId?: string;
  designName?: string;
  error?: string;
  totalDesigns?: number;
  migratedDesigns?: number;
}

export interface MigrationResult {
  attempted: number;
  migrated: number;
  failed: Array<{ designId: string; reason: string }>;
  backupPath?: string;
}

interface DesignRow {
  id: string;
  name: string | null;
  slug: string | null;
  created_at: number | null;
}

interface DesignFileRow {
  design_id: string;
  path: string;
  content: string;
}

interface ChatMessageRow {
  design_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

interface LegacyCommentRow {
  design_id: string;
  kind: string;
  selector: string;
  tag: string;
  text: string;
  status: string;
  created_at: number | string | null;
}

const LEGACY_ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export async function runMigration(opts: MigrationOptions): Promise<MigrationResult> {
  if (!existsSync(opts.sourceDbPath)) {
    return { attempted: 0, migrated: 0, failed: [] };
  }

  if (opts.openDatabase === undefined) {
    throw new Error('Legacy v0.1 migration requires an explicit SQLite opener');
  }
  const open = opts.openDatabase;
  const db = open(opts.sourceDbPath);
  let dbClosed = false;
  const closeDb = (): void => {
    if (dbClosed) return;
    db.close();
    dbClosed = true;
  };

  try {
    const designs = db.prepare('SELECT id, name, slug, created_at FROM designs').all<DesignRow>();
    opts.onProgress?.({ phase: 'start', totalDesigns: designs.length });

    let migrated = 0;
    const failed: MigrationResult['failed'] = [];
    const claimedWorkspaceSlugs = new Set<string>();

    for (const design of designs) {
      opts.onProgress?.({
        phase: 'design-start',
        designId: design.id,
        designName: design.name ?? design.id,
      });
      try {
        await migrateOneDesign(db, design, opts, claimedWorkspaceSlugs);
        migrated++;
        opts.onProgress?.({
          phase: 'design-done',
          designId: design.id,
          migratedDesigns: migrated,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ designId: design.id, reason });
        opts.onProgress?.({ phase: 'design-fail', designId: design.id, error: reason });
      }
    }

    closeDb();
    const backupPath = allocateBackupPath(opts.sourceDbPath);
    renameSync(opts.sourceDbPath, backupPath);
    opts.onProgress?.({ phase: 'complete', migratedDesigns: migrated });
    return { attempted: designs.length, migrated, failed, backupPath };
  } finally {
    closeDb();
  }
}

function allocateBackupPath(sourceDbPath: string): string {
  const base = `${sourceDbPath}.v0.1.backup`;
  if (!existsSync(base)) return base;
  for (let attempt = 2; attempt < 1000; attempt++) {
    const candidate = `${base}.${attempt}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a backup path for ${sourceDbPath}`);
}

async function migrateOneDesign(
  db: MigrationDatabase,
  design: DesignRow,
  opts: MigrationOptions,
  claimedWorkspaceSlugs: Set<string>,
): Promise<void> {
  const slug =
    design.slug === null ? slugify(design.name ?? design.id) : normalizeMigrationSlug(design.slug);
  const workspaceSlug = allocateWorkspaceSlug(opts.workspaceRoot, slug, claimedWorkspaceSlugs);
  const wsdir = path.join(opts.workspaceRoot, workspaceSlug);

  const files = db
    .prepare('SELECT design_id, path, content FROM design_files WHERE design_id = ?')
    .all<DesignFileRow>(design.id);
  const fileWrites = files.map((f) => {
    const filePath = normalizeLegacyDesignFilePath(f.path);
    return {
      filePath,
      writeContent: prepareWorkspaceWriteContent(filePath, f.content),
    };
  });

  const timeline = buildLegacyTimeline(db, design.id);

  mkdirSync(wsdir, { recursive: true });
  for (const { filePath, writeContent } of fileWrites) {
    const dest = path.join(wsdir, filePath);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (typeof writeContent.diskContent === 'string') {
      writeFileSync(dest, writeContent.diskContent, 'utf8');
    } else {
      writeFileSync(dest, writeContent.diskContent);
    }
  }

  const sessionManager = SessionManager.create(wsdir, opts.sessionDir);
  for (const item of timeline) {
    sessionManager.appendMessage(item.message);
  }
}

function buildLegacyTimeline(
  db: MigrationDatabase,
  designId: string,
): Array<{ timestamp: number; message: Message }> {
  const messages = db
    .prepare(
      'SELECT design_id, role, content, created_at FROM chat_messages WHERE design_id = ? ORDER BY created_at ASC',
    )
    .all<ChatMessageRow>(designId);
  const comments = readLegacyComments(db, designId);
  return [
    ...messages.map((msg) => ({
      timestamp: msg.created_at,
      order: 0,
      message: toLegacySessionMessage(msg),
    })),
    ...comments.map((comment) => {
      const timestamp = normalizeLegacyTimestamp(comment.created_at);
      return {
        timestamp,
        order: 1,
        message: toLegacyCommentMessage(comment, timestamp),
      };
    }),
  ]
    .sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
    .map(({ timestamp, message }) => ({ timestamp, message }));
}

function readLegacyComments(db: MigrationDatabase, designId: string): LegacyCommentRow[] {
  try {
    return db
      .prepare(
        'SELECT design_id, kind, selector, tag, text, status, created_at FROM comments WHERE design_id = ? ORDER BY created_at ASC',
      )
      .all<LegacyCommentRow>(designId);
  } catch (cause) {
    if (isMissingLegacyTable(cause, 'comments')) return [];
    throw new Error('Failed to read legacy comments table', { cause });
  }
}

function isMissingLegacyTable(cause: unknown, tableName: string): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new RegExp(`no such table:\\s*${tableName}\\b`, 'i').test(message);
}

function toLegacySessionMessage(msg: ChatMessageRow): Message {
  if (msg.role === 'user') {
    return {
      role: 'user',
      content: msg.content,
      timestamp: msg.created_at,
    };
  }

  return {
    role: 'assistant',
    content: [{ type: 'text', text: msg.content }],
    api: 'legacy-v0.1',
    provider: 'legacy-v0.1',
    model: 'legacy-v0.1',
    usage: LEGACY_ZERO_USAGE,
    stopReason: 'stop',
    timestamp: msg.created_at,
  };
}

function toLegacyCommentMessage(comment: LegacyCommentRow, timestamp: number): Message {
  const lines = [
    'Legacy inline comment migrated from Open CoDesign v0.1.',
    `Kind: ${comment.kind}`,
    `Status: ${comment.status}`,
    `Selector: ${comment.selector}`,
    `Element: <${comment.tag}>`,
    '',
    `Comment: ${comment.text}`,
  ];
  return {
    role: 'user',
    content: [{ type: 'text', text: lines.join('\n').trim() }],
    timestamp,
  };
}

function normalizeLegacyTimestamp(value: number | string | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeMigrationSlug(raw: string): string {
  const slug = raw.trim();
  if (
    slug.length === 0 ||
    slug === '.' ||
    slug === '..' ||
    slug.includes('/') ||
    slug.includes('\\') ||
    path.isAbsolute(slug) ||
    /^[a-zA-Z]:/.test(slug)
  ) {
    throw new Error(`Invalid legacy design slug: ${raw}`);
  }
  return slug;
}

function allocateWorkspaceSlug(
  workspaceRoot: string,
  requestedSlug: string,
  claimedWorkspaceSlugs: Set<string>,
): string {
  let workspaceSlug = requestedSlug;
  for (let attempt = 2; attempt < 1000; attempt++) {
    if (
      !claimedWorkspaceSlugs.has(workspaceSlug) &&
      !existsSync(path.join(workspaceRoot, workspaceSlug))
    ) {
      claimedWorkspaceSlugs.add(workspaceSlug);
      return workspaceSlug;
    }
    workspaceSlug = `${requestedSlug}-${attempt}`;
  }
  throw new Error(
    `Could not allocate a unique workspace directory for legacy design slug: ${requestedSlug}`,
  );
}

function normalizeLegacyDesignFilePath(raw: string): string {
  try {
    return normalizeDesignFilePath(raw);
  } catch (cause) {
    throw new Error(`Invalid legacy design file path: ${raw}`, { cause });
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled'
  );
}
