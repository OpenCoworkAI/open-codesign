import { join } from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

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
 * Surface in UI: Settings → Storage → "Open log folder" (TODO).
 */

let initialized = false;

export function initLogger(): typeof log {
  if (initialized) return log;
  initialized = true;

  log.transports.file.resolvePathFn = () => join(app.getPath('logs'), 'main.log');
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
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

export function getLogger(scope: string) {
  return log.scope(scope);
}

export function getLogPath(): string {
  return join(app.getPath('logs'), 'main.log');
}
