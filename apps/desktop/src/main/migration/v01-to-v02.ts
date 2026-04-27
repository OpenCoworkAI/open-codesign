import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  /** Optional sqlite opener for testing — defaults to better-sqlite3 dynamic import. */
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

export async function runMigration(opts: MigrationOptions): Promise<MigrationResult> {
  if (!existsSync(opts.sourceDbPath)) {
    return { attempted: 0, migrated: 0, failed: [] };
  }

  const open = opts.openDatabase ?? (await defaultOpener());
  const db = open(opts.sourceDbPath);

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

    const backupPath = `${opts.sourceDbPath}.v0.1.backup`;
    renameSync(opts.sourceDbPath, backupPath);
    opts.onProgress?.({ phase: 'complete', migratedDesigns: migrated });
    return { attempted: designs.length, migrated, failed, backupPath };
  } finally {
    db.close();
  }
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
  mkdirSync(wsdir, { recursive: true });

  const files = db
    .prepare('SELECT design_id, path, content FROM design_files WHERE design_id = ?')
    .all<DesignFileRow>(design.id);
  for (const f of files) {
    const filePath = normalizeLegacyDesignFilePath(f.path);
    const dest = path.join(wsdir, filePath);
    const writeContent = prepareWorkspaceWriteContent(filePath, f.content);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (typeof writeContent.diskContent === 'string') {
      writeFileSync(dest, writeContent.diskContent, 'utf8');
    } else {
      writeFileSync(dest, writeContent.diskContent);
    }
  }

  const sessionManager = SessionManager.create(wsdir, opts.sessionDir);
  const messages = db
    .prepare(
      'SELECT design_id, role, content, created_at FROM chat_messages WHERE design_id = ? ORDER BY created_at ASC',
    )
    .all<ChatMessageRow>(design.id);
  for (const msg of messages) {
    sessionManager.appendMessage({
      role: msg.role,
      content: msg.content,
    } as never);
  }
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

async function defaultOpener(): Promise<(path: string) => MigrationDatabase> {
  // Dynamic import so test environments can run without the native
  // module loaded.
  let mod: {
    default: new (path: string, options?: { readonly?: boolean }) => MigrationDatabase;
  };
  try {
    mod = (await import('better-sqlite3')) as typeof mod;
  } catch (cause) {
    throw new Error(
      'better-sqlite3 not available — pass options.openDatabase explicitly when migrating in environments without the native binding.',
      { cause },
    );
  }
  return (path) => new mod.default(path, { readonly: true });
}
