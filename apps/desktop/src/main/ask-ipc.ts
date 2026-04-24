import { randomUUID } from 'node:crypto';
import type { AskInput, AskResult } from '@open-codesign/core';
import { type BrowserWindow, ipcMain } from 'electron';
import { getLogger } from './logger';

/**
 * Bridge for the core `ask` tool. Mirrors permission-ipc.ts:
 *   1. core's ask tool calls `requestAsk(sessionId, input, getMainWindow)`
 *   2. `requestAsk` issues a unique requestId, stores a resolver,
 *      and `webContents.send('ask:request', { requestId, sessionId, input })`
 *   3. renderer mounts <AskModal>, user submits or cancels
 *   4. renderer invokes `ask:resolve` with the requestId + result
 *   5. ipcMain handler resolves the pending promise
 */

const log = getLogger('ask-ipc');

interface PendingAsk {
  resolve: (result: AskResult) => void;
  sessionId: string;
}

const pending = new Map<string, PendingAsk>();

export interface AskRequestPayload {
  requestId: string;
  sessionId: string;
  input: AskInput;
}

export function registerAskIpc(): void {
  ipcMain.handle('ask:resolve', (_event, raw: unknown) => {
    const parsed = parseResolveInput(raw);
    if (!parsed) {
      log.warn('ask:resolve received malformed payload');
      return;
    }
    const entry = pending.get(parsed.requestId);
    if (!entry) {
      log.warn('ask:resolve called with unknown requestId', { requestId: parsed.requestId });
      return;
    }
    pending.delete(parsed.requestId);
    entry.resolve({ status: parsed.status, answers: parsed.answers });
  });
}

export function requestAsk(
  sessionId: string,
  input: AskInput,
  getMainWindow: () => BrowserWindow | null,
): Promise<AskResult> {
  const requestId = `ask-${randomUUID()}`;
  return new Promise<AskResult>((resolve) => {
    pending.set(requestId, { resolve, sessionId });
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      pending.delete(requestId);
      log.warn('ask:request ignored (no main window)');
      resolve({ status: 'cancelled', answers: [] });
      return;
    }
    const payload: AskRequestPayload = { requestId, sessionId, input };
    win.webContents.send('ask:request', payload);
  });
}

export function cancelPendingAskRequests(sessionId: string): void {
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId) continue;
    pending.delete(id);
    entry.resolve({ status: 'cancelled', answers: [] });
  }
}

function parseResolveInput(
  raw: unknown,
): { requestId: string; status: 'answered' | 'cancelled'; answers: AskResult['answers'] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const requestId = typeof obj['requestId'] === 'string' ? obj['requestId'] : null;
  const status = obj['status'];
  const answers = obj['answers'];
  if (!requestId) return null;
  if (status !== 'answered' && status !== 'cancelled') return null;
  if (!Array.isArray(answers)) return null;
  const clean: AskResult['answers'] = [];
  for (const a of answers) {
    if (!a || typeof a !== 'object') return null;
    const rec = a as Record<string, unknown>;
    const questionId = rec['questionId'];
    const value = rec['value'];
    if (typeof questionId !== 'string') return null;
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      !(Array.isArray(value) && value.every((v) => typeof v === 'string'))
    ) {
      return null;
    }
    clean.push({ questionId, value: value as string | number | string[] | null });
  }
  return { requestId, status, answers: clean };
}
