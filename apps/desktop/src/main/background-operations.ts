import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
};
type InstallBackgroundOperationsOptions = {
  root: string;
  ipcMain: IpcMainLike;
  dialog: object;
  shell: object;
  clipboard: object;
  record(kind: string, detail: string): void;
};

const CHANNEL = 'codesign:debug:operation';
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function rejectSymlinks(root: string, target: string, allowMissingLeaf: boolean): void {
  if (!isWithin(root, target)) throw new Error('BACKGROUND_DEBUG_PATH_OUTSIDE_ROOT');
  const rel = relative(root, target);
  let current = root;
  const parts = rel ? rel.split(/[\\/]/) : [];
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) throw new Error('BACKGROUND_DEBUG_SYMLINK_UNSUPPORTED');
      if (i < parts.length - 1 && !info.isDirectory())
        throw new Error('BACKGROUND_DEBUG_PATH_COMPONENT_INVALID');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (i < parts.length - 1 || !allowMissingLeaf) throw error;
    }
  }
}

export function isBackgroundPathAllowed(root: string, input: unknown): boolean {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(input) && !win32.isAbsolute(input)) return false;
  if (input.includes(':') && !(/^[a-zA-Z]:[\\/]/.test(input) && !input.slice(2).includes(':')))
    return false;
  if (win32.isAbsolute(input) || isAbsolute(input)) {
    const target = resolve(input);
    if (!isWithin(root, target)) return false;
    try {
      rejectSymlinks(root, target, true);
    } catch {
      return false;
    }
    return true;
  }
  return !input.split(/[\\/]/).some((part) => part === '..');
}

export function isAbsoluteBackgroundPathAllowed(root: string, input: unknown): boolean {
  return (
    typeof input === 'string' &&
    (isAbsolute(input) || win32.isAbsolute(input)) &&
    isBackgroundPathAllowed(root, input)
  );
}

export function isExistingBackgroundFileAllowed(root: string, input: unknown): boolean {
  if (!isAbsoluteBackgroundPathAllowed(root, input)) return false;
  try {
    const stat = lstatSync(input as string);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function exportDestination(root: string, input: unknown): string {
  if (!isAbsoluteBackgroundPathAllowed(root, input))
    throw new Error('BACKGROUND_DEBUG_PATH_OUTSIDE_ROOT');
  const target = resolve(input as string);
  rejectSymlinks(root, target, true);
  if (existsSync(target) && !lstatSync(target).isFile())
    throw new Error('BACKGROUND_DEBUG_EXPORT_TARGET_INVALID');
  return target;
}

export function installBackgroundOperations(options: InstallBackgroundOperationsOptions): void {
  const root = realpathSync(options.root);
  let destination: string | undefined;
  options.ipcMain.handle(CHANNEL, (_event, payload) => {
    if (!payload || typeof payload !== 'object')
      throw new Error('BACKGROUND_DEBUG_OPERATION_INVALID');
    const input = payload as { operation?: unknown; args?: unknown };
    if (!isKnownBackgroundTestOperation(input.operation))
      throw new Error('BACKGROUND_DEBUG_OPERATION_UNSUPPORTED');
    if (!Array.isArray(input.args) || input.args.length !== 1)
      throw new Error('BACKGROUND_DEBUG_OPERATION_ARGS_INVALID');
    destination = exportDestination(root, input.args[0]);
    options.record('adapter', 'export.destination');
    return { ready: true };
  });
  const wrap = (target: object, name: string, value: (...args: unknown[]) => unknown) =>
    Object.defineProperty(target, name, { configurable: true, value });
  const blocked = (name: string): never => {
    options.record('unsupported', name);
    throw new Error(`BACKGROUND_DEBUG_UNSUPPORTED: ${name}`);
  };
  const save = () => {
    const path = destination;
    destination = undefined;
    return path ? { canceled: false, filePath: exportDestination(root, path) } : { canceled: true };
  };
  wrap(options.dialog, 'showSaveDialog', async () => save());
  wrap(options.dialog, 'showSaveDialogSync', () => save().filePath);
  for (const name of [
    'showOpenDialog',
    'showOpenDialogSync',
    'showMessageBox',
    'showMessageBoxSync',
    'showErrorBox',
  ])
    wrap(options.dialog, name, () => blocked(`dialog.${name}`));
  for (const name of ['openExternal', 'openPath', 'showItemInFolder', 'trashItem', 'beep'])
    wrap(options.shell, name, () => blocked(`shell.${name}`));
  for (const name of [
    'write',
    'writeText',
    'writeHTML',
    'writeImage',
    'writeRTF',
    'writeBuffer',
    'writeBookmark',
    'clear',
    'read',
    'readText',
    'readImage',
    'readHTML',
    'readRTF',
    'readBuffer',
    'readBookmark',
  ])
    wrap(options.clipboard, name, () => blocked(`clipboard.${name}`));
}

export function isKnownBackgroundTestOperation(name: unknown): name is string {
  return name === 'test.exportDestination';
}
