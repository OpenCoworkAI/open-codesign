import { type FSWatcher, watch as nodeWatch } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ipcMain, type WebContents } from 'electron';
import { getLogger } from './logger';

/**
 * Workspace file watcher (T2.3). One watcher per active design tab,
 * built on `node:fs.watch` (no chokidar dep — node 22's recursive
 * watch is stable on macOS / Linux / Windows).
 *
 * Channels:
 *   - 'fs:watch:start' { sessionId, workspacePath } -> {ok}|{ok:false,reason}
 *   - 'fs:watch:stop'  { sessionId } -> {ok}
 *   - 'fs:event'       (push) { sessionId, kind, path, mtime }
 *
 * Ignored: node_modules / .git / .codesign/sessions / .DS_Store, so the
 * agent's own writes don't bounce back.
 */

const log = getLogger('fs-watch');

interface ActiveWatcher {
  watcher: FSWatcher;
  workspacePath: string;
  webContents: WebContents;
}

const watchers = new Map<string, ActiveWatcher>();

const IGNORE_PATTERNS = [
  /(?:^|[\\/])node_modules(?:[\\/]|$)/,
  /(?:^|[\\/])\.git(?:[\\/]|$)/,
  /(?:^|[\\/])\.codesign[\\/]sessions(?:[\\/]|$)/,
  /(?:^|[\\/])\.DS_Store$/,
];

function isIgnored(rel: string): boolean {
  return IGNORE_PATTERNS.some((p) => p.test(rel));
}

export function registerWorkspaceWatcherIpc(): void {
  ipcMain.handle('fs:watch:start', (event, raw: unknown) => {
    const parsed = parseStart(raw);
    if (!parsed) return { ok: false, reason: 'invalid args' };
    return startWatch(parsed.sessionId, parsed.workspacePath, event.sender);
  });
  ipcMain.handle('fs:watch:stop', (_event, raw: unknown) => {
    const parsed = parseStop(raw);
    if (!parsed) return { ok: false, reason: 'invalid args' };
    stopWatch(parsed.sessionId);
    return { ok: true };
  });
}

function startWatch(
  sessionId: string,
  workspacePath: string,
  webContents: WebContents,
): { ok: true } | { ok: false; reason: string } {
  stopWatch(sessionId);
  try {
    const watcher = nodeWatch(workspacePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (isIgnored(filename)) return;
      if (webContents.isDestroyed()) return;
      const absolute = path.join(workspacePath, filename.toString());
      void mtimeOf(absolute).then((mtime) => {
        if (webContents.isDestroyed()) return;
        const kind = mtime === 0 ? 'unlink' : eventType === 'rename' ? 'add' : 'change';
        webContents.send('fs:event', { sessionId, kind, path: absolute, mtime });
      });
    });
    watcher.on('error', (err) => log.warn('fs.watch.error', { sessionId, error: String(err) }));
    watchers.set(sessionId, { watcher, workspacePath, webContents });
    return { ok: true };
  } catch (err) {
    log.error('fs.watch.start.fail', {
      sessionId,
      workspacePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function stopWatch(sessionId: string): void {
  const existing = watchers.get(sessionId);
  if (!existing) return;
  watchers.delete(sessionId);
  try {
    existing.watcher.close();
  } catch (err) {
    log.warn('fs.watch.stop.fail', { sessionId, error: String(err) });
  }
}

async function mtimeOf(p: string): Promise<number> {
  try {
    const s = await stat(p);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

function parseStart(raw: unknown): { sessionId: string; workspacePath: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const sessionId = typeof obj['sessionId'] === 'string' ? obj['sessionId'] : null;
  const workspacePath = typeof obj['workspacePath'] === 'string' ? obj['workspacePath'] : null;
  if (!sessionId || !workspacePath) return null;
  return { sessionId, workspacePath };
}

function parseStop(raw: unknown): { sessionId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const sessionId = typeof obj['sessionId'] === 'string' ? obj['sessionId'] : null;
  return sessionId ? { sessionId } : null;
}

export function shutdownAllWatchers(): void {
  for (const sessionId of Array.from(watchers.keys())) {
    stopWatch(sessionId);
  }
}

export const __test = { isIgnored, IGNORE_PATTERNS };
