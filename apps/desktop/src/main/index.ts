import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '@open-codesign/core';
import { detectProviderFromKey } from '@open-codesign/providers';
import { BRAND, CodesignError, GeneratePayload } from '@open-codesign/shared';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { registerExporterIpc } from './exporter-ipc';
import { getLogPath, getLogger, initLogger } from './logger';
import {
  getApiKeyForProvider,
  getBaseUrlForProvider,
  loadConfigOnBoot,
  registerOnboardingIpc,
} from './onboarding-ipc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

interface RunGenerateArgs {
  payload: GeneratePayload;
  controller: AbortController;
  logIpc: ReturnType<typeof getLogger>;
}

async function runGenerate({ payload, controller, logIpc }: RunGenerateArgs): Promise<unknown> {
  const apiKey = getApiKeyForProvider(payload.model.provider);
  const storedBaseUrl = getBaseUrlForProvider(payload.model.provider);
  const baseUrl = payload.baseUrl ?? storedBaseUrl;
  const id = payload.generationId ?? `gen-${Date.now()}`;

  logIpc.info('generate', {
    id,
    provider: payload.model.provider,
    modelId: payload.model.modelId,
    promptLen: payload.prompt.length,
    historyLen: payload.history.length,
    baseUrl: baseUrl ?? '<default>',
  });
  const t0 = Date.now();
  try {
    const result = await generate({
      prompt: payload.prompt,
      history: payload.history,
      model: payload.model,
      apiKey,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      signal: controller.signal,
    });
    logIpc.info('generate.ok', {
      id,
      ms: Date.now() - t0,
      artifacts: (result as { artifacts?: unknown[] }).artifacts?.length ?? 0,
      cost: (result as { costUsd?: number }).costUsd,
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
  }
}

function registerIpcHandlers(): void {
  const logIpc = getLogger('ipc');

  /** In-flight requests: generationId → AbortController */
  const inFlight = new Map<string, AbortController>();

  ipcMain.handle('codesign:detect-provider', (_e, key: unknown) => {
    if (typeof key !== 'string') {
      throw new CodesignError('detect-provider expects a string key', 'IPC_BAD_INPUT');
    }
    return detectProviderFromKey(key);
  });

  ipcMain.handle('codesign:generate', async (_e, raw: unknown) => {
    const payload = GeneratePayload.parse(raw);
    const controller = new AbortController();
    const id = payload.generationId ?? `gen-${Date.now()}`;
    inFlight.set(id, controller);
    try {
      return await runGenerate({ payload, controller, logIpc });
    } finally {
      inFlight.delete(id);
    }
  });

  ipcMain.handle('codesign:cancel-generation', (_e, raw: unknown) => {
    const id = typeof raw === 'string' ? raw : undefined;
    if (id !== undefined) {
      const controller = inFlight.get(id);
      if (controller) {
        controller.abort();
        inFlight.delete(id);
        logIpc.info('generate.cancelled', { id });
      }
    } else {
      for (const [key, controller] of inFlight) {
        controller.abort();
        logIpc.info('generate.cancelled', { id: key });
      }
      inFlight.clear();
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
  registerOnboardingIpc();
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
