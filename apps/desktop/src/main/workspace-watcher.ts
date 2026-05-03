import { type Dirent, type FSWatcher, watch as nodeWatch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import { type Database, getDesign } from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';
import { WORKSPACE_IGNORED_DIRS } from './workspace-reader';

/**
 * Files watcher (T2.3 follow-up). Without this, edits made in Finder / a
 * separate IDE while the agent is idle never reach the renderer's Files
 * panel — the existing `useDesignFiles` hook only refetches on agent stream
 * events.
 *
 * Channels:
 *   - `codesign:files:v1:subscribe`   { schemaVersion: 1, designId } → { ok }
 *   - `codesign:files:v1:unsubscribe` { schemaVersion: 1, designId } → { ok }
 *   - `codesign:files:v1:changed`     (push) { schemaVersion: 1, designId }
 *
 * One ref-counted watcher per designId. Started on first subscribe, kept
 * alive across short remounts via a 5-minute idle teardown timer. Bursts
 * are coalesced into a single emit per 250ms so a `pnpm install` in the
 * workspace doesn't spam IPC.
 *
 * Uses `node:fs.watch({recursive: true})` — works on macOS (FSEvents) and
 * Linux (recent kernel). No chokidar dep; Windows recursive coverage is
 * weaker but we're macOS-first.
 */

const log = getLogger('files-watcher');

/** Coalesce bursts of fs events into one IPC emit. */
const COALESCE_MS = 250;
/** Keep an idle watcher alive briefly so quick tab-switches don't churn. */
const IDLE_TEARDOWN_MS = 5 * 60_000;
/** Permission-constrained Windows folders can reject recursive fs.watch. */
const POLL_INTERVAL_MS = 2_000;

interface ActiveWatcher {
  watcher: FSWatcher | null;
  workspacePath: string;
  refCount: number;
  pendingEmit: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollSnapshot: string | null;
  pollBusy: boolean;
}

const watchers = new Map<string, ActiveWatcher>();

function isIgnored(rel: string): boolean {
  if (!rel) return true;
  if (rel.endsWith('.DS_Store')) return true;
  for (const seg of rel.split(/[\\/]/)) {
    if (WORKSPACE_IGNORED_DIRS.has(seg)) return true;
  }
  return false;
}

function toForwardSlashes(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function isPermissionWatchError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES';
}

async function pollWorkspaceSignature(root: string): Promise<string> {
  const rows: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = toForwardSlashes(relative(root, abs));
      if (entry.isDirectory()) {
        if (isIgnored(rel)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile() || isIgnored(rel)) continue;
      try {
        const s = await stat(abs);
        rows.push(`${rel}\0${s.size}\0${s.mtimeMs}`);
      } catch {
        // Locked files are common during editor saves. Skip this polling pass;
        // the next interval will pick up the settled metadata.
      }
    }
  }

  await walk(root);
  rows.sort();
  return rows.join('\n');
}

function scheduleEmit(designId: string, getWin: () => BrowserWindow | null): void {
  const entry = watchers.get(designId);
  if (!entry) return;
  if (entry.pendingEmit) return;
  entry.pendingEmit = setTimeout(() => {
    entry.pendingEmit = null;
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('codesign:files:v1:changed', { schemaVersion: 1, designId });
  }, COALESCE_MS);
}

function startPolling(
  designId: string,
  entry: ActiveWatcher,
  getWin: () => BrowserWindow | null,
): void {
  if (entry.pollTimer) return;
  const poll = async (): Promise<void> => {
    if (entry.pollBusy) return;
    entry.pollBusy = true;
    try {
      const nextSnapshot = await pollWorkspaceSignature(entry.workspacePath);
      if (entry.pollSnapshot === null) {
        entry.pollSnapshot = nextSnapshot;
      } else if (entry.pollSnapshot !== nextSnapshot) {
        entry.pollSnapshot = nextSnapshot;
        scheduleEmit(designId, getWin);
      }
    } catch (err) {
      log.warn('files.watch.poll.fail', {
        designId,
        workspacePath: entry.workspacePath,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      entry.pollBusy = false;
    }
  };

  void poll();
  entry.pollTimer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
  log.info('files.watch.polling.start', { designId, workspacePath: entry.workspacePath });
}

function startWatcher(
  designId: string,
  workspacePath: string,
  getWin: () => BrowserWindow | null,
): ActiveWatcher | null {
  const entry: ActiveWatcher = {
    watcher: null,
    workspacePath,
    refCount: 0,
    pendingEmit: null,
    idleTimer: null,
    pollTimer: null,
    pollSnapshot: null,
    pollBusy: false,
  };
  let watcher: FSWatcher;
  try {
    watcher = nodeWatch(workspacePath, { recursive: true }, (_eventType, filename) => {
      if (filename && isIgnored(filename.toString())) return;
      scheduleEmit(designId, getWin);
    });
  } catch (err) {
    log.warn('files.watch.start.fail', {
      designId,
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    });
    if (isPermissionWatchError(err)) {
      watchers.set(designId, entry);
      startPolling(designId, entry, getWin);
      return entry;
    }
    return null;
  }
  entry.watcher = watcher;
  watcher.on('error', (err) => {
    log.warn('files.watch.error', { designId, error: String(err) });
    if (!isPermissionWatchError(err)) return;
    const active = watchers.get(designId);
    if (!active || active.watcher !== watcher) return;
    try {
      watcher.close();
    } catch (closeErr) {
      log.warn('files.watch.stop.fail', { designId, error: String(closeErr) });
    }
    active.watcher = null;
    startPolling(designId, active, getWin);
  });
  watchers.set(designId, entry);
  return entry;
}

function stopWatcher(designId: string): void {
  const entry = watchers.get(designId);
  if (!entry) return;
  if (entry.pendingEmit) clearTimeout(entry.pendingEmit);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  watchers.delete(designId);
  try {
    entry.watcher?.close();
  } catch (err) {
    log.warn('files.watch.stop.fail', { designId, error: String(err) });
  }
}

export function registerFilesWatcherIpc(db: Database, getWin: () => BrowserWindow | null): void {
  ipcMain.handle('codesign:files:v1:subscribe', (_e: unknown, raw: unknown): { ok: true } => {
    const designId = parseDesignId(raw, 'subscribe');
    const design = getDesign(db, designId);
    if (design === null) {
      throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
    }
    if (design.workspacePath === null) {
      throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
    }
    let workspacePath: string;
    try {
      workspacePath = normalizeWorkspacePath(design.workspacePath);
    } catch (cause) {
      throw new CodesignError('Stored workspace path is invalid', 'IPC_BAD_INPUT', { cause });
    }
    const existing = watchers.get(designId);
    if (existing) {
      if (existing.workspacePath !== workspacePath) {
        stopWatcher(designId);
      } else {
        if (existing.idleTimer) {
          clearTimeout(existing.idleTimer);
          existing.idleTimer = null;
        }
        existing.refCount += 1;
        return { ok: true };
      }
    }
    const entry = startWatcher(designId, workspacePath, getWin);
    if (!entry) {
      throw new CodesignError('Failed to watch workspace files', 'IPC_DB_ERROR');
    }
    entry.refCount = 1;
    return { ok: true };
  });

  ipcMain.handle('codesign:files:v1:unsubscribe', (_e: unknown, raw: unknown): { ok: true } => {
    const designId = parseDesignId(raw, 'unsubscribe');
    const entry = watchers.get(designId);
    if (!entry) return { ok: true };
    entry.refCount -= 1;
    if (entry.refCount > 0) return { ok: true };
    entry.refCount = 0;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => stopWatcher(designId), IDLE_TEARDOWN_MS);
    return { ok: true };
  });
}

function parseDesignId(raw: unknown, channel: string): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(
      `codesign:files:v1:${channel} expects { schemaVersion: 1, designId }`,
      'IPC_BAD_INPUT',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(
      `codesign:files:v1:${channel} requires schemaVersion: 1`,
      'IPC_BAD_INPUT',
    );
  }
  const id = r['designId'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return id;
}

export function shutdownAllFilesWatchers(): void {
  for (const id of Array.from(watchers.keys())) stopWatcher(id);
}

export const __test = {
  isIgnored,
  watchers,
  COALESCE_MS,
  IDLE_TEARDOWN_MS,
  POLL_INTERVAL_MS,
  pollWorkspaceSignature,
  stopWatcher,
};
