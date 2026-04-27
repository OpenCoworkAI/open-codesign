import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
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
  reject: (reason?: unknown) => void;
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
    const requestId = readRequestId(raw, 'permission:resolve');
    const entry = pending.get(requestId);
    if (!entry) {
      throw new CodesignError(
        `permission:resolve called with unknown requestId "${requestId}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    let parsed: { requestId: string; scope: PermissionScope | 'deny' };
    try {
      parsed = parseResolveInput(raw);
    } catch (err) {
      pending.delete(requestId);
      entry.reject(err);
      throw err;
    }
    pending.delete(requestId);
    entry.resolve({ scope: parsed.scope });
  });
}

export function requestPermission(
  sessionId: string,
  command: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<PermissionResolution> {
  const requestId = `perm-${Date.now()}-${nextId++}`;
  return new Promise<PermissionResolution>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, command, sessionId });
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

function parseResolveInput(raw: unknown): { requestId: string; scope: PermissionScope | 'deny' } {
  const requestId = readRequestId(raw, 'permission:resolve');
  const obj = raw as Record<string, unknown>;
  const unsupported = Object.keys(obj).find((key) => key !== 'requestId' && key !== 'scope');
  if (unsupported !== undefined) {
    throw new CodesignError(
      `permission:resolve contains unsupported field "${unsupported}"`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const scope = obj['scope'];
  if (scope !== 'once' && scope !== 'always' && scope !== 'deny') {
    throw new CodesignError(
      'permission:resolve scope must be "once", "always", or "deny"',
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return { requestId, scope };
}

function readRequestId(raw: unknown, channel: string): string {
  if (!raw || typeof raw !== 'object') {
    throw new CodesignError(`${channel} expects an object payload`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const obj = raw as Record<string, unknown>;
  const requestId = obj['requestId'];
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw new CodesignError(`${channel} requires a non-empty requestId`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return requestId;
}
