import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import log from 'electron-log/main';
import { app } from './electron-runtime';
import { currentRunId } from './runContext';
import { getActiveStorageLocations } from './storage-settings';

/**
 * Centralized logger for the main + preload + renderer processes.
 *
 * Files:
 *   macOS:   ~/Library/Logs/open-codesign/main.log
 *   Windows: %APPDATA%/open-codesign/logs/main.log
 *   Linux:   ~/.config/open-codesign/logs/main.log
 *
 * Console mirror: WARN+ in dev, ERROR only in prod, off when packaged-quiet.
 * Format example:
 *   [2026-04-18 12:34:56.789] [info] [main:onboarding] save-key provider=openai
 *
 * Surface in UI: Settings → Diagnostics → "Open log folder" and "Export
 * diagnostic bundle" (shipped in PR4).
 */

let initialized = false;

export function defaultLogsDir(): string {
  return app.getPath('logs');
}

export function logsDir(): string {
  return getActiveStorageLocations().logsDir ?? defaultLogsDir();
}

export function initLogger(): typeof log {
  if (initialized) return log;
  initialized = true;

  log.transports.file.resolvePathFn = () => getLogPath();
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
  log.transports.file.archiveLogFn = (oldFile: { path: string } | string) => {
    const p = typeof oldFile === 'string' ? oldFile : oldFile.path;
    rotateLogFile(p, { existsSync, renameSync, unlinkSync });
  };
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}';
  log.transports.console.level = app.isPackaged ? 'warn' : 'info';
  log.transports.console.format = '[{level}] {scope} {text}';

  log.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error, processType }: { error: Error; processType?: string }) => {
      log.error(`[crash:${processType ?? 'main'}]`, error);
    },
  });

  log.eventLogger.startLogging({
    events: {
      app: { ready: true, 'window-all-closed': true },
      webContents: {},
    },
  });

  log.scope.labelPadding = false;
  log.info('[boot] open-codesign starting', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  });

  return log;
}

export interface ScopedLogger {
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
}

export function getLogger(scope: string): ScopedLogger {
  const scoped = log.scope(scope);
  const wrap =
    (level: 'info' | 'warn' | 'error') => (event: string, data?: Record<string, unknown>) => {
      const runId = currentRunId();
      const merged = runId !== undefined ? { runId, ...(data ?? {}) } : data;
      if (merged === undefined) {
        scoped[level](event);
      } else {
        scoped[level](event, merged);
      }
    };
  return { info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
}

export function getLogPath(): string {
  return join(logsDir(), 'main.log');
}

/**
 * Rotation policy for main.log: on overflow, keep up to 2 previous files.
 *   main.log       -> main.old.log
 *   main.old.log   -> main.old.1.log (if main.old.log exists before rotate)
 *   main.old.1.log -> discarded
 *
 * Synchronous so electron-log v5's archive callback can complete
 * before the next write. Every fs op is wrapped in try/catch: a Windows
 * file-lock (EBUSY) or a TOCTOU race between existsSync and the rename
 * must not bubble into electron-log and silently disable rotation going
 * forward. Failures are reported via `onError` (defaults to a console
 * recovery writer since we cannot recurse through `getLogger` from inside the
 * archive callback).
 */
export function rotateLogFile(
  activePath: string,
  fs: {
    existsSync: (p: string) => boolean;
    renameSync: (a: string, b: string) => void;
    unlinkSync: (p: string) => void;
  },
  onError: (step: string, err: unknown) => void = defaultRotateOnError,
): void {
  const dir = dirname(activePath);
  const base = basename(activePath);
  const stem = base.replace(/\.log$/, '');
  const old = join(dir, `${stem}.old.log`);
  const oldest = join(dir, `${stem}.old.1.log`);
  try {
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  } catch (err) {
    onError('unlink_oldest', err);
  }
  try {
    if (fs.existsSync(old)) fs.renameSync(old, oldest);
  } catch (err) {
    onError('rename_old_to_oldest', err);
  }
  try {
    if (fs.existsSync(activePath)) fs.renameSync(activePath, old);
  } catch (err) {
    onError('rename_active_to_old', err);
  }
}

function defaultRotateOnError(step: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // Write directly to stderr — we cannot route through getLogger() here
  // because this runs inside electron-log's archive callback and would
  // recurse. Stderr guarantees the failure is visible in `pnpm dev` and
  // crash logs without creating additional file I/O.
  process.stderr.write(`[logger:rotate] ${step} failed: ${message}\n`);
}
