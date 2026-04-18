import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { type CoreLogger, applyComment, generate } from '@open-codesign/core';
import { detectProviderFromKey } from '@open-codesign/providers';
import {
  ApplyCommentPayload,
  BRAND,
  CancelGenerationPayloadV1,
  CodesignError,
  GeneratePayload,
  GeneratePayloadV1,
} from '@open-codesign/shared';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { registerConnectionIpc } from './connection-ipc';
import { scanDesignSystem } from './design-system';
import { BrowserWindow, app, dialog, ipcMain, shell } from './electron-runtime';
import { registerExporterIpc } from './exporter-ipc';
import { cancelGenerationRequest } from './generation-ipc';
import { registerLocaleIpc } from './locale-ipc';
import { getLogPath, getLogger, initLogger } from './logger';
import {
  getApiKeyForProvider,
  getCachedConfig,
  getOnboardingState,
  loadConfigOnBoot,
  registerOnboardingIpc,
  setDesignSystem,
} from './onboarding-ipc';
import { registerPreferencesIpc } from './preferences-ipc';
import { preparePromptContext } from './prompt-context';
import { resolveActiveModel } from './provider-settings';
import { safeInitSnapshotsDb } from './snapshots-db';
import { registerSnapshotsIpc, registerSnapshotsUnavailableIpc } from './snapshots-ipc';

let mainWindow: ElectronBrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: BRAND.backgroundColor,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpcHandlers(): void {
  const logIpc = getLogger('main:ipc');

  /** Adapter so `core` can log step events through the same scoped electron-log
   * sink the IPC handler uses. Keeps a single timeline per generation in the
   * log file without forcing `core` to depend on electron-log. */
  const coreLoggerFor = (id: string): CoreLogger => ({
    info: (event, data) => logIpc.info(event, { id, ...(data ?? {}) }),
    error: (event, data) => logIpc.error(event, { id, ...(data ?? {}) }),
  });

  /** In-flight requests: generationId → AbortController */
  const inFlight = new Map<string, AbortController>();

  ipcMain.handle('codesign:detect-provider', (_e, key: unknown) => {
    if (typeof key !== 'string') {
      throw new CodesignError('detect-provider expects a string key', 'IPC_BAD_INPUT');
    }
    return detectProviderFromKey(key);
  });

  ipcMain.handle('codesign:pick-input-files', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile', 'multiSelections'],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
        });
    if (result.canceled || result.filePaths.length === 0) return [];
    return Promise.all(
      result.filePaths.map(async (path) => {
        try {
          const info = await stat(path);
          return { path, name: basename(path), size: info.size };
        } catch {
          return { path, name: basename(path), size: 0 };
        }
      }),
    );
  });

  ipcMain.handle('codesign:pick-design-system-directory', async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
    if (result.canceled || result.filePaths.length === 0) return getOnboardingState();
    const rootPath = result.filePaths[0];
    if (!rootPath) return getOnboardingState();
    logIpc.info('designSystem.scan.start', { rootPath });
    const snapshot = await scanDesignSystem(rootPath);
    const nextState = await setDesignSystem(snapshot);
    logIpc.info('designSystem.scan.ok', {
      rootPath,
      sourceFiles: snapshot.sourceFiles.length,
      colors: snapshot.colors.length,
      fonts: snapshot.fonts.length,
    });
    return nextState;
  });

  ipcMain.handle('codesign:clear-design-system', async () => {
    const nextState = await setDesignSystem(null);
    logIpc.info('designSystem.clear');
    return nextState;
  });

  ipcMain.handle('codesign:v1:generate', async (_e, raw: unknown) => {
    const payload = GeneratePayloadV1.parse(raw);
    const controller = new AbortController();
    const id = payload.generationId;
    inFlight.set(id, controller);
    const coreLogger = coreLoggerFor(id);

    coreLogger.info('[generate] step=load_config');
    const loadStart = Date.now();
    const cfg = getCachedConfig();
    if (cfg === null) {
      inFlight.delete(id);
      throw new CodesignError(
        'No configuration found. Complete onboarding first.',
        'CONFIG_MISSING',
      );
    }
    // Snap to the canonical active provider in cachedConfig — the SAME source
    // the Settings UI uses for the Active badge — so the actual call cannot
    // diverge from what the user sees.
    const active = resolveActiveModel(cfg, payload.model);
    const apiKey = getApiKeyForProvider(active.model.provider);
    // Once we've snapped to the canonical active provider, the renderer-supplied
    // baseUrl can no longer be trusted — it may belong to a different (stale)
    // provider and would route the active provider's API key to the wrong host.
    // Always use the per-provider baseUrl from cached config, and mutate the
    // payload itself so any downstream reader cannot accidentally pick up the
    // stale renderer value.
    const baseUrl = active.baseUrl ?? undefined;
    if (active.overridden) {
      payload.baseUrl = baseUrl;
    }
    coreLogger.info('[generate] step=load_config.ok', {
      ms: Date.now() - loadStart,
      hasApiKey: apiKey.length > 0,
      baseUrl: baseUrl ?? '<default>',
    });

    if (active.overridden) {
      coreLogger.info('[generate] step=resolve_active.override', {
        requested: payload.model.provider,
        requestedModelId: payload.model.modelId,
        active: active.model.provider,
        activeModelId: active.model.modelId,
      });
    }

    const stepCtx = {
      id,
      provider: active.model.provider,
      modelId: active.model.modelId,
    };
    coreLogger.info('[generate] step=validate_provider', stepCtx);
    if (apiKey.length === 0) {
      coreLogger.error('[generate] step=validate_provider.fail', {
        provider: active.model.provider,
        reason: 'missing_api_key',
      });
      inFlight.delete(id);
      throw new CodesignError(
        `No API key configured for provider "${active.model.provider}". Open Settings to add one.`,
        'PROVIDER_AUTH_MISSING',
      );
    }
    coreLogger.info('[generate] step=validate_provider.ok', { provider: active.model.provider });

    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

    logIpc.info('generate', {
      id,
      provider: active.model.provider,
      modelId: active.model.modelId,
      ...(active.overridden
        ? { requestedProvider: payload.model.provider, requestedModelId: payload.model.modelId }
        : {}),
      promptLen: payload.prompt.length,
      historyLen: payload.history.length,
      attachmentCount: payload.attachments.length,
      hasReferenceUrl: payload.referenceUrl !== undefined,
      hasDesignSystem: promptContext.designSystem !== null,
      baseUrl: baseUrl ?? '<default>',
    });

    const t0 = Date.now();
    try {
      const result = await generate({
        prompt: payload.prompt,
        history: payload.history,
        model: active.model,
        apiKey,
        attachments: promptContext.attachments,
        referenceUrl: promptContext.referenceUrl,
        designSystem: promptContext.designSystem ?? null,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        signal: controller.signal,
        logger: coreLogger,
      });
      logIpc.info('generate.ok', {
        id,
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('generate.fail', {
        id,
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        baseUrl: baseUrl ?? '<default>',
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    } finally {
      inFlight.delete(id);
    }
  });

  // Legacy shim — kept for one minor release while older renderer builds still
  // send codesign:generate without schemaVersion. Remove after v0.3.
  ipcMain.handle('codesign:generate', async (_e, raw: unknown) => {
    logIpc.warn('legacy codesign:generate channel used, schedule removal next minor');
    const legacy = GeneratePayload.parse(raw);
    const id = legacy.generationId ?? `gen-${Date.now()}`;
    const v1Raw = { schemaVersion: 1 as const, ...legacy, generationId: id };
    const payload = GeneratePayloadV1.parse(v1Raw);
    const controller = new AbortController();
    inFlight.set(id, controller);

    const cfg = getCachedConfig();
    if (cfg === null) {
      inFlight.delete(id);
      throw new CodesignError(
        'No configuration found. Complete onboarding first.',
        'CONFIG_MISSING',
      );
    }
    const active = resolveActiveModel(cfg, payload.model);
    const apiKey = getApiKeyForProvider(active.model.provider);
    // See codesign:v1:generate above — renderer baseUrl is ignored post-snap.
    const baseUrl = active.baseUrl ?? undefined;
    if (active.overridden) {
      payload.baseUrl = baseUrl;
    }
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

    logIpc.info('generate', {
      id,
      provider: active.model.provider,
      modelId: active.model.modelId,
      ...(active.overridden
        ? { requestedProvider: payload.model.provider, requestedModelId: payload.model.modelId }
        : {}),
      promptLen: payload.prompt.length,
      historyLen: payload.history.length,
      attachmentCount: payload.attachments.length,
      hasReferenceUrl: payload.referenceUrl !== undefined,
      hasDesignSystem: promptContext.designSystem !== null,
      baseUrl: baseUrl ?? '<default>',
    });

    const t0 = Date.now();
    try {
      const result = await generate({
        prompt: payload.prompt,
        history: payload.history,
        model: active.model,
        apiKey,
        attachments: promptContext.attachments,
        referenceUrl: promptContext.referenceUrl,
        designSystem: promptContext.designSystem ?? null,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        signal: controller.signal,
      });
      logIpc.info('generate.ok', {
        id,
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('generate.fail', {
        id,
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        baseUrl: baseUrl ?? '<default>',
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    } finally {
      inFlight.delete(id);
    }
  });

  ipcMain.handle('codesign:v1:cancel-generation', (_e, raw: unknown) => {
    const { generationId } = CancelGenerationPayloadV1.parse(raw);
    cancelGenerationRequest(generationId, inFlight, logIpc);
  });

  ipcMain.handle('codesign:apply-comment', async (_e, raw: unknown) => {
    const payload = ApplyCommentPayload.parse(raw);
    const cfg = getCachedConfig();
    if (cfg === null) {
      throw new CodesignError(
        'No configuration found. Complete onboarding first.',
        'CONFIG_MISSING',
      );
    }
    // Inline-comment edits don't need to be tied to whatever provider was
    // pinned in the original generate; resolve fresh against the canonical
    // active provider so a switch in Settings takes effect immediately.
    const hint = payload.model ?? { provider: cfg.provider, modelId: cfg.modelFast };
    const active = resolveActiveModel(cfg, hint);
    const apiKey = getApiKeyForProvider(active.model.provider);
    const baseUrl = active.baseUrl ?? undefined;
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

    logIpc.info('applyComment', {
      provider: active.model.provider,
      modelId: active.model.modelId,
      ...(active.overridden
        ? { requestedProvider: hint.provider, requestedModelId: hint.modelId }
        : {}),
      selector: payload.selection.selector,
      attachmentCount: payload.attachments.length,
      hasReferenceUrl: payload.referenceUrl !== undefined,
      hasDesignSystem: promptContext.designSystem !== null,
      baseUrl: baseUrl ?? '<default>',
    });

    const t0 = Date.now();
    try {
      const result = await applyComment({
        html: payload.html,
        comment: payload.comment,
        selection: payload.selection,
        model: active.model,
        apiKey,
        attachments: promptContext.attachments,
        referenceUrl: promptContext.referenceUrl,
        designSystem: promptContext.designSystem ?? null,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
      logIpc.info('applyComment.ok', {
        ms: Date.now() - t0,
        artifacts: result.artifacts.length,
        cost: result.costUsd,
      });
      return result;
    } catch (err) {
      logIpc.error('applyComment.fail', {
        ms: Date.now() - t0,
        provider: active.model.provider,
        modelId: active.model.modelId,
        selector: payload.selection.selector,
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof CodesignError ? err.code : undefined,
      });
      throw err;
    }
  });

  ipcMain.handle('codesign:open-log-folder', async () => {
    await shell.openPath(getLogPath());
  });
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('codesign:update-available', info);
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('codesign:update-error', err.message);
  });
  ipcMain.handle('codesign:check-for-updates', () => autoUpdater.checkForUpdates());
  ipcMain.handle('codesign:download-update', () => autoUpdater.downloadUpdate());
  ipcMain.handle('codesign:install-update', () => autoUpdater.quitAndInstall());
}

void app.whenReady().then(async () => {
  initLogger();
  await loadConfigOnBoot();
  // Snapshot persistence is best-effort at boot — a failure here (corrupt DB,
  // permission denied, missing native binding) must NOT block the BrowserWindow
  // from opening. Surface it via an error dialog and skip registering the
  // snapshots IPC channels; the rest of the app stays usable.
  const dbResult = safeInitSnapshotsDb(join(app.getPath('userData'), 'designs.db'));
  if (dbResult.ok) {
    registerSnapshotsIpc(dbResult.db);
  } else {
    const bootLog = getLogger('main:boot');
    bootLog.error('snapshotsDb.init.fail', {
      message: dbResult.error.message,
      stack: dbResult.error.stack,
    });
    // Install stub handlers so renderer-side calls reject with a typed
    // SNAPSHOTS_UNAVAILABLE CodesignError instead of Electron's opaque
    // "No handler registered" rejection — see snapshots-ipc.ts.
    registerSnapshotsUnavailableIpc(dbResult.error.message);
    dialog.showErrorBox(
      'Design history unavailable',
      `Could not open the local snapshots database. Version history will be disabled for this session.\n\n${dbResult.error.message}`,
    );
  }
  registerIpcHandlers();
  registerLocaleIpc();
  registerConnectionIpc();
  registerOnboardingIpc();
  registerPreferencesIpc();
  registerExporterIpc(() => mainWindow);
  setupAutoUpdater();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
