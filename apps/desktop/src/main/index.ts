import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyComment, generate } from '@open-codesign/core';
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
  getBaseUrlForProvider,
  getCachedConfig,
  getOnboardingState,
  loadConfigOnBoot,
  registerOnboardingIpc,
  setDesignSystem,
} from './onboarding-ipc';
import { registerPreferencesIpc } from './preferences-ipc';
import { preparePromptContext } from './prompt-context';

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

    const apiKey = getApiKeyForProvider(payload.model.provider);
    const storedBaseUrl = getBaseUrlForProvider(payload.model.provider);
    const baseUrl = payload.baseUrl ?? storedBaseUrl;
    const cfg = getCachedConfig();
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg?.designSystem ?? null,
    });

    logIpc.info('generate', {
      id,
      provider: payload.model.provider,
      modelId: payload.model.modelId,
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
        model: payload.model,
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
        provider: payload.model.provider,
        modelId: payload.model.modelId,
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

    const apiKey = getApiKeyForProvider(payload.model.provider);
    const storedBaseUrl = getBaseUrlForProvider(payload.model.provider);
    const baseUrl = payload.baseUrl ?? storedBaseUrl;
    const cfg = getCachedConfig();
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg?.designSystem ?? null,
    });

    logIpc.info('generate', {
      id,
      provider: payload.model.provider,
      modelId: payload.model.modelId,
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
        model: payload.model,
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
        provider: payload.model.provider,
        modelId: payload.model.modelId,
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
    const model = payload.model ?? { provider: cfg.provider, modelId: cfg.modelFast };
    const apiKey = getApiKeyForProvider(model.provider);
    const storedBaseUrl = getBaseUrlForProvider(model.provider);
    const promptContext = await preparePromptContext({
      attachments: payload.attachments,
      referenceUrl: payload.referenceUrl,
      designSystem: cfg.designSystem ?? null,
    });

    logIpc.info('applyComment', {
      provider: model.provider,
      modelId: model.modelId,
      selector: payload.selection.selector,
      attachmentCount: payload.attachments.length,
      hasReferenceUrl: payload.referenceUrl !== undefined,
      hasDesignSystem: promptContext.designSystem !== null,
      baseUrl: storedBaseUrl ?? '<default>',
    });

    const t0 = Date.now();
    try {
      const result = await applyComment({
        html: payload.html,
        comment: payload.comment,
        selection: payload.selection,
        model,
        apiKey,
        attachments: promptContext.attachments,
        referenceUrl: promptContext.referenceUrl,
        designSystem: promptContext.designSystem ?? null,
        ...(storedBaseUrl !== undefined ? { baseUrl: storedBaseUrl } : {}),
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
        provider: model.provider,
        modelId: model.modelId,
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
