import { type BrowserWindow, ipcMain } from 'electron';
import { getLogger } from './logger';

/**
 * Bridge that turns the synchronous-looking `permissionHook` passed to
 * `createCodesignSession` into an async round-trip with the renderer.
 *
 * Flow:
 *   1. core's bash hook calls `requestPermission(sessionId, command)`
 *   2. `requestPermission` issues a unique `requestId`, stores the resolver,
 *      and `webContents.send('permission:request', payload)` to the renderer
 *   3. renderer mounts <PermissionDialog>, user clicks Deny / Allow / Always
 *   4. renderer invokes `permission:resolve` with the requestId + decision
 *   5. ipcMain handler resolves the stored promise; bash hook returns
 *      `{block, reason}` accordingly
 *
 * "Always allow" is forwarded to allowlist-store.ts (T2.2) which persists
 * the prefix into `<workspace>/.codesign/settings.json` so subsequent
 * matching commands are auto-approved without a round-trip.
 */

const log = getLogger('permission-ipc');

export type PermissionScope = 'once' | 'always';
export interface PermissionResolution {
  scope: PermissionScope | 'deny';
}

interface PendingRequest {
  resolve: (decision: PermissionResolution) => void;
  command: string;
  sessionId: string;
}

const pending = new Map<string, PendingRequest>();
let nextId = 0;

export interface PermissionRequestPayload {
  requestId: string;
  sessionId: string;
  command: string;
}

export function registerPermissionIpc(): void {
  ipcMain.handle('permission:resolve', (_event, raw: unknown) => {
    const parsed = parseResolveInput(raw);
    if (!parsed) return;
    const entry = pending.get(parsed.requestId);
    if (!entry) {
      log.warn('permission:resolve called with unknown requestId', { requestId: parsed.requestId });
      return;
    }
    pending.delete(parsed.requestId);
    entry.resolve({ scope: parsed.scope });
  });
}

export function requestPermission(
  sessionId: string,
  command: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<PermissionResolution> {
  const requestId = `perm-${Date.now()}-${nextId++}`;
  return new Promise<PermissionResolution>((resolve) => {
    pending.set(requestId, { resolve, command, sessionId });
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      pending.delete(requestId);
      log.warn('permission:request ignored (no main window)');
      resolve({ scope: 'deny' });
      return;
    }
    const payload: PermissionRequestPayload = { requestId, sessionId, command };
    win.webContents.send('permission:request', payload);
  });
}

export function cancelPendingPermissionRequests(sessionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId) continue;
    pending.delete(id);
    entry.resolve({ scope: 'deny' });
  }
}

function parseResolveInput(
  raw: unknown,
): { requestId: string; scope: PermissionScope | 'deny' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const requestId = typeof obj['requestId'] === 'string' ? obj['requestId'] : null;
  const scope = obj['scope'];
  if (!requestId) return null;
  if (scope !== 'once' && scope !== 'always' && scope !== 'deny') return null;
  return { requestId, scope };
}
