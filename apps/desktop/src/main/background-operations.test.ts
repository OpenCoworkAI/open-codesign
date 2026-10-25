import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installBackgroundOperations, isBackgroundPathAllowed } from './background-operations';

const roots: string[] = [];
function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'codesign-background-ops-'));
  roots.push(root);
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const dialog: Record<string, unknown> = {};
  const shell: Record<string, unknown> = {};
  const clipboard: Record<string, unknown> = {};
  installBackgroundOperations({
    root,
    dialog,
    shell,
    clipboard,
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    record: () => undefined,
  });
  const call = (operation: string, ...args: unknown[]) =>
    handlers.get('codesign:debug:operation')?.(null, { operation, args });
  const save = () => (dialog['showSaveDialog'] as () => Promise<unknown>)();
  return { root, dialog, shell, clipboard, call, save };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('background export destination', () => {
  it('provides one root-contained save destination and cancels subsequent saves', async () => {
    const host = createHarness();
    const target = join(host.root, 'design.html');
    await expect(host.save()).resolves.toEqual({ canceled: true });
    expect(host.call('test.exportDestination', target)).toEqual({ ready: true });
    await expect(host.save()).resolves.toEqual({ canceled: false, filePath: target });
    await expect(host.save()).resolves.toEqual({ canceled: true });
    expect(() => host.call('test.exportDestination', '../outside.html')).toThrow();
    expect(() =>
      host.call('test.exportDestination', resolve(host.root, '..', 'outside.html')),
    ).toThrow();
    expect(() => host.call('test.exportDestination', host.root)).toThrow();
    expect(() => host.call('test.exportDestination', target, 'extra')).toThrow();
  });

  it('blocks peripheral helpers and native host effects', () => {
    const host = createHarness();
    for (const operation of ['test.files.write', 'test.dialog.enqueue', 'test.clipboard.read'])
      expect(() => host.call(operation)).toThrow('BACKGROUND_DEBUG_OPERATION_UNSUPPORTED');
    for (const [target, name] of [
      [host.clipboard, 'writeText'],
      [host.shell, 'openExternal'],
      [host.dialog, 'showOpenDialog'],
    ] as const)
      expect(() => (target[name] as () => unknown)()).toThrow('BACKGROUND_DEBUG_UNSUPPORTED');
    expect(isBackgroundPathAllowed(host.root, 'App.jsx')).toBe(true);
    expect(isBackgroundPathAllowed(host.root, '../outside')).toBe(false);
  });

  it('rejects directory junction escapes, including a replaced parent after selection', async () => {
    const host = createHarness();
    const outside = mkdtempSync(join(tmpdir(), 'codesign-background-outside-'));
    roots.push(outside);
    const protectedFile = join(outside, 'keep.html');
    writeFileSync(protectedFile, 'unchanged');
    const exports = join(host.root, 'exports');
    mkdirSync(exports);
    host.call('test.exportDestination', join(exports, 'keep.html'));
    rmdirSync(exports);
    symlinkSync(outside, exports, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(host.save()).rejects.toThrow();
    expect(() => host.call('test.exportDestination', join(exports, 'keep.html'))).toThrow();
    expect(isBackgroundPathAllowed(host.root, join(exports, 'keep.html'))).toBe(false);
    expect(readFileSync(protectedFile, 'utf8')).toBe('unchanged');
  });
});
