import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// A development host restriction, additional to the normal IPC validation and permissions.
const ALLOWED_CHANNELS = new Set([
  'locale:get-current',
  'locale:get-system',
  'onboarding:get-state',
  'settings:v1:list-providers',
  'ask:list-pending',
  'ask:history',
  'preferences:v1:get',
  'diagnostics:v1:listEvents',
  'diagnostics:v1:log',
  'diagnostics:v1:recordRendererError',
  'codesign:v1:generation-status',
  'codesign:v1:recover-runs',
  'codesign:v1:usage-budget',
  'codesign:v1:active-messages',
  'snapshots:v1:list-designs',
  'snapshots:v1:get-design',
  'snapshots:v1:create-design',
  'snapshots:v1:rename-design',
  'snapshots:v1:list',
  'snapshots:v1:get',
  'snapshots:v1:workspace:check',
  'chat:v1:list',
  'chat:v1:seed-from-snapshots',
  'comments:v1:list',
  'comments:v1:list-pending-edits',
  'codesign:files:v1:list',
  'codesign:files:v1:list-dir',
  'codesign:files:v1:read',
  'codesign:files:v1:subscribe',
  'codesign:files:v1:unsubscribe',
]);

export function isBackgroundChannelAllowed(channel: string, payload: unknown): boolean {
  if (!ALLOWED_CHANNELS.has(channel)) return false;
  if (channel === 'snapshots:v1:create-design' && payload && typeof payload === 'object') {
    // Only the normal auto-allocated workspace, inside the disposable Documents directory.
    const input = payload as Record<string, unknown>;
    if (input['workspacePath'] != null || input['demoInputId'] != null) return false;
  }
  return true;
}

export function initializeBackgroundDebug(electron: typeof import('electron')): boolean {
  const root = process.env['CODESIGN_BACKGROUND_DEBUG_ROOT'];
  if (root === undefined) return false;
  const { app, ipcMain, dialog, shell, clipboard } = electron;
  // Refuse existing profiles: this path must be a new empty directory created by the runner.
  if (app.isPackaged || !isAbsolute(root) || readdirSync(root).length !== 0) {
    throw new Error('Background debug requires an unpackaged app and a fresh empty absolute root');
  }
  for (const name of [
    'userData',
    'sessionData',
    'crashDumps',
    'logs',
    'home',
    'documents',
    'downloads',
    'temp',
  ] as const) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
  process.env['XDG_CONFIG_HOME'] = join(root, 'config');
  mkdirSync(join(root, 'config/open-codesign'), { recursive: true });
  writeFileSync(
    join(root, 'config/open-codesign/locale.json'),
    JSON.stringify({ schemaVersion: 1, locale: 'en' }),
  );
  process.env['HOME'] = join(root, 'home');
  process.env['USERPROFILE'] = join(root, 'home');
  app.disableHardwareAcceleration();
  const record = (kind: string, detail: string) => {
    appendFileSync(join(root, 'host-events.jsonl'), `${JSON.stringify({ kind, detail })}\n`);
  };
  process.on('uncaughtException', () => {
    record('crash', 'uncaught-exception');
    app.exit(1);
  });
  const parent = Number(process.env['CODESIGN_BACKGROUND_DEBUG_PARENT']);
  if (!Number.isSafeInteger(parent) || parent <= 0) throw new Error('Missing debug runner parent');
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      app.exit(1);
    }
  }, 2000).unref();
  const blocked = (operation: string): never => {
    record('unsupported', operation);
    throw new Error(`BACKGROUND_DEBUG_UNSUPPORTED: ${operation}`);
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, ...args: unknown[]) => {
      if (!isBackgroundChannelAllowed(channel, args[0])) return blocked(channel);
      return listener(event, ...args);
    });
  for (const name of [
    'showOpenDialog',
    'showOpenDialogSync',
    'showSaveDialog',
    'showSaveDialogSync',
    'showMessageBox',
    'showMessageBoxSync',
    'showErrorBox',
  ] as const) {
    Object.defineProperty(dialog, name, { value: () => blocked(`dialog.${name}`) });
  }
  for (const name of [
    'openExternal',
    'openPath',
    'showItemInFolder',
    'trashItem',
    'beep',
  ] as const) {
    Object.defineProperty(shell, name, { value: () => blocked(`shell.${name}`) });
  }
  for (const name of [
    'write',
    'writeText',
    'writeHTML',
    'writeImage',
    'writeRTF',
    'writeBuffer',
    'writeBookmark',
    'clear',
    'readText',
    'readImage',
    'readHTML',
    'readBuffer',
  ] as const) {
    Object.defineProperty(clipboard, name, { value: () => blocked(`clipboard.${name}`) });
  }
  app.on('browser-window-created', (_event, window) => {
    for (const name of ['show', 'showInactive', 'focus', 'restore'] as const) {
      Object.defineProperty(window, name, { value: () => blocked(`window.${name}`) });
    }
    window.on('show', () => record('violation', 'visible-window'));
    window.on('focus', () => record('violation', 'focused-window'));
    window.webContents.setAudioMuted(true);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) =>
      respond(false),
    );
    window.webContents.session.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, respond) => respond({ cancel: true }),
    );
    window.webContents.on('render-process-gone', (_event, details) =>
      record('crash', details.reason),
    );
  });
  return true;
}
