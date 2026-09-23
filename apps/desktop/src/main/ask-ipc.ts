import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AskInput, AskResult } from '@open-codesign/core';
import { type AskCancelledV1, CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  type AskHistoryEntry,
  type AskHistoryFilter,
  type AskRequestPayload,
  AskStore,
} from './ask-store';
import { getLogger } from './logger';

export type { AskRequestPayload } from './ask-store';

const log = getLogger('ask-ipc');
interface PendingAsk {
  resolve: (result: AskResult) => void;
  reject: (reason?: unknown) => void;
  payload: AskRequestPayload;
  ready: Promise<AskHistoryEntry>;
  cleanup: () => void;
  cancelling: boolean;
}
const pending = new Map<string, PendingAsk>();
let store: AskStore | undefined;

function getStore(): AskStore {
  store ??= new AskStore(join(app.getPath('userData'), 'ask-journal.jsonl'));
  return store;
}

export function registerAskIpc(storePath?: string): void {
  if (storePath !== undefined) {
    if (pending.size > 0) throw new Error('Cannot replace ask store with live questions');
    store = new AskStore(storePath);
  }
  ipcMain.handle('ask:list-pending', () => listPendingAskRequests());
  ipcMain.handle('ask:history', (_event, filter: unknown) =>
    getStore().history(parseHistoryFilter(filter)),
  );
  ipcMain.handle('ask:resolve', async (_event, raw: unknown) => {
    // Invalid renderer submissions must not consume the runtime's original promise.
    const { requestId, ...result } = parseResolveInput(raw);
    await pending.get(requestId)?.ready;
    const entry = await getStore().settle(requestId, result);
    finish(entry);
  });
}

function finish(entry: AskHistoryEntry): void {
  if (!entry.result) return;
  const live = pending.get(entry.requestId);
  pending.delete(entry.requestId);
  live?.cleanup();
  live?.resolve(entry.result);
  log.info('ask.resolve', {
    sessionId: entry.sessionId,
    requestId: entry.requestId,
    status: entry.status,
  });
  const payload = {
    requestId: entry.requestId,
    sessionId: entry.sessionId,
    ...(entry.runId ? { runId: entry.runId } : {}),
    ...(entry.designId ? { designId: entry.designId } : {}),
    status: entry.status,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('ask:resolved', payload);
        if (entry.status === 'cancelled') {
          const cancelled: AskCancelledV1 = {
            schemaVersion: 1,
            requestId: entry.requestId,
            sessionId: entry.sessionId,
          };
          win.webContents.send('ask:cancelled', cancelled);
        }
      }
    } catch (error) {
      log.warn('ask.resolve.delivery_failed', { requestId: entry.requestId, error: String(error) });
    }
  }
}

async function cancelRequest(requestId: string): Promise<void> {
  const live = pending.get(requestId);
  if (!live) return;
  live.cancelling = true;
  try {
    await live.ready;
    const entry = await getStore().settle(requestId, { status: 'cancelled', answers: [] });
    finish(entry);
  } catch (error) {
    if (pending.get(requestId) !== live) return;
    pending.delete(requestId);
    live.cleanup();
    live.reject(error);
    log.error('ask.cancel.failed', { requestId, error: String(error) });
  }
}

export interface RequestAskOptions {
  designId?: string;
  signal?: AbortSignal;
}

export function requestAsk(
  sessionId: string,
  input: AskInput,
  getMainWindow: () => BrowserWindow | null,
  optionsOrSignal: RequestAskOptions | AbortSignal = {},
): Promise<AskResult> {
  const options: RequestAskOptions =
    'aborted' in optionsOrSignal ? { signal: optionsOrSignal } : optionsOrSignal;
  const requestId = `ask-${randomUUID()}`;
  const payload: AskRequestPayload = {
    requestId,
    sessionId,
    runId: sessionId,
    ...(options.designId ? { designId: options.designId } : {}),
    input: structuredClone(input),
  };
  return new Promise<AskResult>((resolve, reject) => {
    const onAbort = () => {
      void cancelRequest(requestId);
    };
    const live: PendingAsk = {
      resolve,
      reject,
      payload,
      ready: getStore().create(payload),
      cleanup: () => options.signal?.removeEventListener('abort', onAbort),
      cancelling: false,
    };
    pending.set(requestId, live);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    void live.ready
      .then(() => {
        if (pending.get(requestId) !== live || live.cancelling) return;
        // Window closure/reload is not cancellation: pending() replays after remount.
        try {
          const win = getMainWindow();
          if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
          win.webContents.send('ask:request', payload);
        } catch (error) {
          log.warn('ask.request.delivery_failed', { requestId, error: String(error) });
        }
      })
      .catch((error: unknown) => {
        if (pending.get(requestId) !== live) return;
        pending.delete(requestId);
        live.cleanup();
        reject(error);
      });
  });
}

export async function listPendingAskRequests(): Promise<AskRequestPayload[]> {
  const history = await getStore().history();
  return history
    .filter((entry) => entry.status === 'pending' && pending.has(entry.requestId))
    .map((entry) => ({
      requestId: entry.requestId,
      sessionId: entry.sessionId,
      ...(entry.runId ? { runId: entry.runId } : {}),
      ...(entry.designId ? { designId: entry.designId } : {}),
      input: entry.input,
    }));
}

export async function cancelPendingAskRequests(sessionId: string): Promise<void> {
  await Promise.all(
    [...pending]
      .filter(([, entry]) => entry.payload.sessionId === sessionId)
      .map(([id]) => cancelRequest(id)),
  );
}

function parseHistoryFilter(raw: unknown): AskHistoryFilter {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CodesignError('ask:history expects a filter object', ERROR_CODES.IPC_BAD_INPUT);
  }
  const filter = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (!['runId', 'designId'].includes(key) || typeof value !== 'string' || !value.trim()) {
      throw new CodesignError('ask:history invalid filter', ERROR_CODES.IPC_BAD_INPUT);
    }
  }
  return filter as AskHistoryFilter;
}

function badResolvePayload(message: string): never {
  throw new CodesignError(`ask:resolve ${message}`, ERROR_CODES.IPC_BAD_INPUT);
}

function readRequestId(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    badResolvePayload('expects an object payload');
  const requestId = (raw as Record<string, unknown>)['requestId'];
  if (typeof requestId !== 'string' || requestId.trim().length === 0)
    badResolvePayload('requires a non-empty requestId');
  return requestId;
}

function parseResolveInput(raw: unknown): { requestId: string } & AskResult {
  const requestId = readRequestId(raw);
  const obj = raw as Record<string, unknown>;
  assertKnownFields(obj, ['requestId', 'status', 'answers']);
  const status = obj['status'];
  const answers = obj['answers'];
  if (status !== 'answered' && status !== 'cancelled')
    badResolvePayload('status must be "answered" or "cancelled"');
  if (!Array.isArray(answers)) badResolvePayload('answers must be an array');
  const clean: AskResult['answers'] = [];
  for (const a of answers) {
    if (!a || typeof a !== 'object' || Array.isArray(a))
      badResolvePayload('answers must contain objects');
    const rec = a as Record<string, unknown>;
    assertKnownFields(rec, ['questionId', 'value']);
    const questionId = rec['questionId'];
    const value = rec['value'];
    if (typeof questionId !== 'string' || !questionId.trim())
      badResolvePayload('answer questionId must be a non-empty string');
    if (
      value !== null &&
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value)) &&
      !(Array.isArray(value) && value.every((v) => typeof v === 'string'))
    ) {
      badResolvePayload('answer value must be a string, finite number, string array, or null');
    }
    clean.push({ questionId, value: value as string | number | string[] | null });
  }
  return { requestId, status, answers: clean };
}
function assertKnownFields(record: Record<string, unknown>, allowed: readonly string[]): void {
  const unsupported = Object.keys(record).find((key) => !allowed.includes(key));
  if (unsupported !== undefined) badResolvePayload(`contains unsupported field "${unsupported}"`);
}
