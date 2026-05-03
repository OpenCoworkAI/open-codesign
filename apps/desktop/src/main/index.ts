import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '@open-codesign/shared';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { registerAppMenu } from './app-menu';
import { registerAskIpc } from './ask-ipc';
import { showBootDialog, writeBootErrorSync } from './boot-fallback';
import { migrateStaleCodexEntryIfNeeded, registerCodexOAuthIpc } from './codex-oauth-ipc';
import { configDir } from './config';
import { registerConnectionIpc } from './connection-ipc';
import { registerDiagnosticsIpc } from './diagnostics-ipc';
import { app, BrowserWindow, clipboard, dialog, shell } from './electron-runtime';
import { ensureUserTemplates, resolveBundledTemplatesDir } from './ensure-user-templates';
import { registerExporterIpc } from './exporter-ipc';
import { registerImageGenerationSettingsIpc } from './image-generation-settings';
import { maybeAbortIfRunningFromDmg } from './install-check';
import { registerIpcHandlers } from './ipc/register';
import { getPendingUpdate, setupAutoUpdater } from './ipc/update';
import { registerLocaleIpc } from './locale-ipc';
import { getLogger, initLogger } from './logger';
import { loadConfigOnBoot, registerOnboardingIpc } from './onboarding-ipc';
import { isAllowedExternalUrl } from './open-external';
import { readPersisted as readPreferences, registerPreferencesIpc } from './preferences-ipc';
import { cleanupStaleTmps } from './reported-fingerprints';
import { type Database, pruneDiagnosticEvents, safeInitSnapshotsDb } from './snapshots-db';
import {
  registerSnapshotsIpc,
  registerSnapshotsUnavailableIpc,
  registerWorkspaceIpc,
} from './snapshots-ipc';
import { initStorageSettings } from './storage-settings';
import { getUpdateErrorMessage, isMissingUpdateMetadataError } from './update-errors';
import { registerWorkspaceProtocolHandler, registerWorkspaceScheme } from './workspace-protocol';

// Re-exports kept for index.workspace.test.ts and any external callers.
export { createRuntimeTextEditorFs, resolveLocalAssetRefs } from './ipc/runtime-fs';

// ESM shim: package.json "type": "module" means the built bundle is ESM and
// __dirname/__filename don't exist. Derive them from import.meta.url so the
// existing join(__dirname, '../preload/...') calls keep working.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: ElectronBrowserWindow | null = null;
const getMainWindow = (): ElectronBrowserWindow | null => mainWindow;

const IS_VITEST = process.env['VITEST'] === 'true';
const IS_SMOKE_TEST =
  process.argv.includes('--smoke-test') || process.env['CODESIGN_SMOKE_TEST'] === '1';
const smokeUserDataDir = process.env['CODESIGN_SMOKE_USER_DATA_DIR'];
if (IS_SMOKE_TEST && smokeUserDataDir !== undefined && smokeUserDataDir.trim().length > 0) {
  mkdirSync(smokeUserDataDir, { recursive: true });
  app.setPath('userData', smokeUserDataDir);
}

const defaultUserDataDir = app.getPath('userData');
const storageLocations = initStorageSettings(defaultUserDataDir);
if (storageLocations.dataDir !== undefined) {
  mkdirSync(storageLocations.dataDir, { recursive: true });
  app.setPath('userData', storageLocations.dataDir);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: BRAND.backgroundColor,
    icon: join(__dirname, '../../resources/icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  // Null the reference on close so stale IPC sends from async emitters
  // (autoUpdater, long-running generate runs) become clean no-ops rather
  // than throwing "Object has been destroyed" on a discarded webContents.
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    // Gate `window.open(...)` through the same allowlist as
    // `codesign:v1:open-external`, otherwise any renderer path that triggers
    // a new-window event could coerce the main process into opening an
    // attacker-controlled URL.
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Replay any update event that fired before this window was ready
  // (macOS: user closed window, triggered a manual Check for Updates from
  // the app menu, then reopened — the event would otherwise be lost).
  mainWindow.webContents.on('did-finish-load', () => {
    const pending = getPendingUpdate();
    if (pending !== null) {
      mainWindow?.webContents.send('codesign:update-available', pending);
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function scheduleStartupUpdateCheck(): Promise<void> {
  if (!app.isPackaged) return;
  const prefs = await readPreferences();
  if (prefs.checkForUpdatesOnStartup === false) return;
  setTimeout(() => {
    const updateLog = getLogger('main:updates');
    try {
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        const message = getUpdateErrorMessage(err);
        if (isMissingUpdateMetadataError(err)) {
          updateLog.warn('startup.checkForUpdates.missingChannel', { message });
          return;
        }
        updateLog.error('startup.checkForUpdates.fail', { message });
      });
    } catch (err) {
      const message = getUpdateErrorMessage(err);
      if (isMissingUpdateMetadataError(err)) {
        updateLog.warn('startup.checkForUpdates.missingChannel', { message });
        return;
      }
      updateLog.error('startup.checkForUpdates.throw', { message });
    }
  }, 30_000);
}

if (!IS_VITEST) {
  registerWorkspaceScheme();

  void app.whenReady().then(async () => {
    // Extracted so the outer try/catch AND post-init listeners (whose callbacks
    // fire outside this block) can route failures through the same boot-fallback
    // path. Without this, a later createWindow() throw from app.on('activate')
    // would bypass writeBootErrorSync and leave the user with nothing to attach.
    const handleBootFailure = (err: unknown, title: string, message: string): void => {
      let logsDir: string;
      try {
        logsDir = app.getPath('logs');
      } catch {
        logsDir = app.getPath('temp');
      }
      const bootLogPath = writeBootErrorSync({
        error: err,
        logsDir,
        appVersion: app.getVersion(),
        platform: process.platform,
        electronVersion: process.versions.electron ?? 'unknown',
        nodeVersion: process.versions.node,
      });
      const choice = showBootDialog(app, dialog, {
        type: 'error',
        title,
        message,
        detail: `Error: ${err instanceof Error ? err.message : String(err)}\n\nDiagnostic log: ${bootLogPath}`,
        buttons: ['Copy diagnostic path', 'Open log folder', 'Quit'],
        defaultId: 2,
        cancelId: 2,
      });
      if (choice === 0) clipboard.writeText(bootLogPath);
      if (choice === 1) shell.showItemInFolder(bootLogPath);
    };

    try {
      initLogger();
      // Single-instance lock. Two simultaneous Electron instances would race
      // `cleanupStaleTmps` vs `writeAtomic` (B's cleanup unlinks A's in-flight
      // tmp → ENOENT rename) and collide on local JSON writes. macOS usually
      // enforces this at the OS level, but `open -n` defeats that — so we
      // acquire the lock explicitly before touching any shared files.
      const gotLock = app.requestSingleInstanceLock();
      if (!gotLock) {
        app.quit();
        return;
      }
      app.on('second-instance', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      // Show a blocking dialog if the user launched from the DMG mount. If
      // they accept the remedy, we quit here before touching safeStorage / the
      // snapshots DB so nothing half-initialises against a bad install.
      const aborted = await maybeAbortIfRunningFromDmg();
      if (aborted) return;
      await loadConfigOnBoot();
      // Seed `<userData>/templates/` from the bundled resources if it does
      // not already exist. After the first boot the user owns the tree —
      // edits to scaffolds, skills, brand-refs, frames, or design-skills
      // survive upgrades, and deleting the folder re-seeds on next launch.
      const bootLog = getLogger('main:boot');
      const templatesSource = resolveBundledTemplatesDir(process.resourcesPath);
      const seeded = await ensureUserTemplates(app.getPath('userData'), templatesSource);
      bootLog.info('templates.ensure', { ...seeded });
      // One-shot migration for experimental-branch testers whose config.toml
      // still carries stale codex wire/baseUrl. No-op on fresh installs.
      await migrateStaleCodexEntryIfNeeded();
      // Best-effort sweep of leftover `<file>.tmp.<pid>` siblings from previous
      // crashes. pid changes across restarts so without this the config dir
      // accumulates 0o600 litter forever.
      cleanupStaleTmps(join(configDir(), 'reported-fingerprints.json'));
      // Design metadata persistence is best-effort at boot — a failure here
      // (corrupt JSON, permission denied) must NOT block the BrowserWindow
      // from opening. Surface it via an error dialog and skip registering the
      // snapshots IPC channels; the rest of the app stays usable.
      const dbResult = safeInitSnapshotsDb(join(app.getPath('userData'), 'design-store.json'));
      const diagnosticsDb: Database | null = dbResult.ok ? dbResult.db : null;
      if (dbResult.ok) {
        registerSnapshotsIpc(dbResult.db);
        registerWorkspaceIpc(dbResult.db, getMainWindow);
        registerWorkspaceProtocolHandler({
          db: dbResult.db,
          logger: getLogger('workspace-protocol'),
        });
        try {
          pruneDiagnosticEvents(dbResult.db, 500);
        } catch (err) {
          getLogger('main:boot').warn('diagnosticEvents.prune.fail', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        bootLog.error('snapshotsDb.init.fail', {
          message: dbResult.error.message,
          stack: dbResult.error.stack,
        });
        if (IS_SMOKE_TEST) throw dbResult.error;
        // Install stub handlers so renderer-side calls reject with a typed
        // SNAPSHOTS_UNAVAILABLE CodesignError instead of Electron's opaque
        // "No handler registered" rejection — see snapshots-ipc.ts.
        registerSnapshotsUnavailableIpc(dbResult.error.message);
        dialog.showErrorBox(
          'Design history unavailable',
          `Could not open the local design store. Version history will be disabled for this session.\n\n${dbResult.error.message}`,
        );
      }
      const teardownIpc = registerIpcHandlers(diagnosticsDb, getMainWindow);
      app.on('before-quit', teardownIpc);
      registerLocaleIpc();
      registerConnectionIpc();
      registerOnboardingIpc();
      registerCodexOAuthIpc();
      registerPreferencesIpc();
      registerImageGenerationSettingsIpc();
      registerExporterIpc(getMainWindow);
      registerDiagnosticsIpc(diagnosticsDb);
      registerAskIpc();
      if (IS_SMOKE_TEST) {
        bootLog.info('smoke.ok', { arch: process.arch, platform: process.platform });
        process.stdout.write(
          `codesign smoke.ok arch=${process.arch} platform=${process.platform}\n`,
        );
        app.quit();
        return;
      }
      setupAutoUpdater(getMainWindow);
      registerAppMenu();
      createWindow();
      void scheduleStartupUpdateCheck();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          try {
            createWindow();
          } catch (err) {
            handleBootFailure(err, 'Cannot reopen window', 'Window failed to open.');
          }
        }
      });
    } catch (err) {
      if (IS_SMOKE_TEST) {
        process.stderr.write(
          `codesign smoke.fail ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
        );
        app.exit(1);
        return;
      }
      // Last-resort boot-phase handler. Reached when something before
      // `initLogger()` finishes (or during the first few setup calls)
      // throws — our electron-log sink might not exist yet, so write a
      // best-effort sync log and show a native three-button dialog.
      handleBootFailure(
        err,
        'Open CoDesign failed to start',
        'A startup error prevented the app from loading.',
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
