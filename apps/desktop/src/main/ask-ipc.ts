import { randomUUID } from 'node:crypto';
import type { AskInput, AskResult } from '@open-codesign/core';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
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
  reject: (reason?: unknown) => void;
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
    const requestId = readRequestId(raw, 'ask:resolve');
    const entry = pending.get(requestId);
    if (!entry) {
      throw new CodesignError(
        `ask:resolve called with unknown requestId "${requestId}"`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    let parsed: {
      requestId: string;
      status: 'answered' | 'cancelled';
      answers: AskResult['answers'];
    };
    try {
      parsed = parseResolveInput(raw);
    } catch (err) {
      pending.delete(requestId);
      entry.reject(err);
      throw err;
    }
    pending.delete(requestId);
    entry.resolve({ status: parsed.status, answers: parsed.answers });
  });
}

export function requestAsk(
  sessionId: string,
  input: AskInput,
  getMainWindow: () => BrowserWindow | null,
): Promise<AskResult> {
  const requestId = `ask-${randomUUID()}`;
  return new Promise<AskResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, sessionId });
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

function badResolvePayload(message: string): never {
  throw new CodesignError(`ask:resolve ${message}`, ERROR_CODES.IPC_BAD_INPUT);
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

function parseResolveInput(raw: unknown): {
  requestId: string;
  status: 'answered' | 'cancelled';
  answers: AskResult['answers'];
} {
  const requestId = readRequestId(raw, 'ask:resolve');
  const obj = raw as Record<string, unknown>;
  assertKnownFields(obj, ['requestId', 'status', 'answers']);
  const status = obj['status'];
  const answers = obj['answers'];
  if (status !== 'answered' && status !== 'cancelled') {
    badResolvePayload('status must be "answered" or "cancelled"');
  }
  if (!Array.isArray(answers)) badResolvePayload('answers must be an array');
  const clean: AskResult['answers'] = [];
  for (const a of answers) {
    if (!a || typeof a !== 'object') badResolvePayload('answers must contain objects');
    const rec = a as Record<string, unknown>;
    assertKnownFields(rec, ['questionId', 'value']);
    const questionId = rec['questionId'];
    const value = rec['value'];
    if (typeof questionId !== 'string') badResolvePayload('answer questionId must be a string');
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      !(Array.isArray(value) && value.every((v) => typeof v === 'string'))
    ) {
      badResolvePayload('answer value must be a string, number, string array, or null');
    }
    clean.push({ questionId, value: value as string | number | string[] | null });
  }
  return { requestId, status, answers: clean };
}

function assertKnownFields(record: Record<string, unknown>, allowed: readonly string[]): void {
  const unsupported = Object.keys(record).find((key) => !allowed.includes(key));
  if (unsupported !== undefined) badResolvePayload(`contains unsupported field "${unsupported}"`);
}
