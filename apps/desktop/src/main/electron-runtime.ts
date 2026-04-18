import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const electron = require('electron') as typeof import('electron');

export const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = electron;
