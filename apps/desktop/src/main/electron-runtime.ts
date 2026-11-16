import { createRequire } from 'node:module';
import { initializeBackgroundDebug } from './background-debug';

const require = createRequire(import.meta.url);

export const electron = require('electron') as typeof import('electron');
export const BACKGROUND_DEBUG = (() => {
  try {
    return initializeBackgroundDebug(electron);
  } catch {
    // Electron's default import-error dialog would steal focus even before createWindow.
    process.stderr.write(
      'BACKGROUND_DEBUG_SETUP_FAILED: isolated development host could not start\n',
    );
    process.exit(1);
  }
})();

export const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  safeStorage,
  shell,
} = electron;
