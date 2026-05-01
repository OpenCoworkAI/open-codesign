import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SessionManager } from '@open-codesign/core';
import type {
  ChatAppendInput,
  ChatMessageKind,
  ChatMessageRow,
  ChatToolCallPayload,
} from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import type { Database } from './db/native-binding';
import { getDesign, listSnapshots } from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';

export const CHAT_MESSAGE_CUSTOM_TYPE = 'open-codesign.chat.message';
export const CHAT_TOOL_STATUS_CUSTOM_TYPE = 'open-codesign.chat.tool_status';

export interface SessionChatStoreOptions {
  db: Database;
  sessionDir: string;
}

export interface ChatToolStatusUpdate {
  designId: string;
  seq: number;
  status: 'done' | 'error';
  result?: unknown;
  durationMs?: number;
  errorMessage?: string;
}

interface StoredChatMessage {
  schemaVersion: 1;
  id: number;
  seq: number;
  kind: ChatMessageKind;
  payload: unknown;
  snapshotId: string | null;
}

interface StoredToolStatusUpdate {
  schemaVersion: 1;
  seq: number;
  status: 'done' | 'error';
  result?: unknown;
  durationMs?: number;
  errorMessage?: string;
}

interface CustomEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  timestamp?: string;
}

function sessionFileForDesign(sessionDir: string, designId: string): string {
  const safeId = designId.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(sessionDir, `${safeId}.jsonl`);
}

function resolveSessionCwd(opts: SessionChatStoreOptions, designId: string): string {
  const design = getDesign(opts.db, designId);
  if (design === null) {
    throw new CodesignError('Design not found', 'IPC_NOT_FOUND');
  }
  if (design.workspacePath === null) {
    throw new CodesignError('Design is not bound to a workspace', 'IPC_BAD_INPUT');
  }
  try {
    return normalizeWorkspacePath(design.workspacePath);
  } catch (cause) {
    throw new CodesignError('Stored workspace path is invalid', 'IPC_BAD_INPUT', { cause });
  }
}

function openSession(opts: SessionChatStoreOptions, designId: string): SessionManager {
  mkdirSync(opts.sessionDir, { recursive: true });
  const file = sessionFileForDesign(opts.sessionDir, designId);
  return SessionManager.open(file, opts.sessionDir, resolveSessionCwd(opts, designId));
}

function flushSession(manager: SessionManager): void {
  const file = manager.getSessionFile();
  const header = manager.getHeader();
  if (file === undefined || header === null) {
    throw new CodesignError('Session file unavailable', 'IPC_DB_ERROR');
  }
  // pi defers writing user-only sessions; desktop chat must persist immediately.
  mkdirSync(path.dirname(file), { recursive: true });
  const lines = [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry));
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStoredMessage(value: unknown): StoredChatMessage | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  if (typeof value['id'] !== 'number') return null;
  if (typeof value['seq'] !== 'number') return null;
  if (typeof value['kind'] !== 'string') return null;
  const snapshotId = value['snapshotId'];
  if (snapshotId !== null && typeof snapshotId !== 'string') return null;
  return {
    schemaVersion: 1,
    id: value['id'],
    seq: value['seq'],
    kind: value['kind'] as ChatMessageKind,
    payload: value['payload'] ?? {},
    snapshotId,
  };
}

function parseStatusUpdate(value: unknown): StoredToolStatusUpdate | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  if (typeof value['seq'] !== 'number') return null;
  if (value['status'] !== 'done' && value['status'] !== 'error') return null;
  const base: StoredToolStatusUpdate = {
    schemaVersion: 1,
    seq: value['seq'],
    status: value['status'],
  };
  return {
    ...base,
    ...(value['result'] !== undefined ? { result: value['result'] } : {}),
    ...(typeof value['durationMs'] === 'number' ? { durationMs: value['durationMs'] } : {}),
    ...(typeof value['errorMessage'] === 'string' ? { errorMessage: value['errorMessage'] } : {}),
  };
}

function applyStatusUpdate(row: ChatMessageRow, update: StoredToolStatusUpdate): ChatMessageRow {
  if (row.kind !== 'tool_call') return row;
  const prev = isRecord(row.payload) ? row.payload : {};
  const nextPayload: ChatToolCallPayload = {
    ...(prev as unknown as ChatToolCallPayload),
    status: update.status,
    ...(update.result !== undefined ? { result: update.result } : {}),
    ...(update.durationMs !== undefined ? { durationMs: update.durationMs } : {}),
    ...(update.errorMessage !== undefined
      ? { error: { message: update.errorMessage }, errorMessage: update.errorMessage }
      : {}),
  };
  return { ...row, payload: nextPayload };
}

function replayEntries(designId: string, entries: unknown[]): ChatMessageRow[] {
  const rows: ChatMessageRow[] = [];
  for (const raw of entries) {
    const entry = raw as CustomEntryLike;
    if (entry.type !== 'custom') continue;
    if (entry.customType === CHAT_MESSAGE_CUSTOM_TYPE) {
      const stored = parseStoredMessage(entry.data);
      if (stored === null) {
        throw new CodesignError('Malformed stored chat message entry', 'IPC_DB_ERROR');
      }
      rows.push({
        schemaVersion: 1,
        id: stored.id,
        designId,
        seq: stored.seq,
        kind: stored.kind,
        payload: stored.payload,
        snapshotId: stored.snapshotId,
        createdAt: entry.timestamp ?? new Date(0).toISOString(),
      });
      continue;
    }
    if (entry.customType === CHAT_TOOL_STATUS_CUSTOM_TYPE) {
      const update = parseStatusUpdate(entry.data);
      if (update === null) {
        throw new CodesignError('Malformed stored chat tool-status entry', 'IPC_DB_ERROR');
      }
      const idx = rows.findIndex((row) => row.seq === update.seq);
      if (idx < 0) {
        throw new CodesignError(
          'Stored chat tool-status entry references a missing message',
          'IPC_DB_ERROR',
        );
      }
      const row = rows[idx];
      if (row) rows[idx] = applyStatusUpdate(row, update);
    }
  }
  return rows;
}

export function listSessionChatMessages(
  opts: SessionChatStoreOptions,
  designId: string,
): ChatMessageRow[] {
  const cwd = resolveSessionCwd(opts, designId);
  const file = sessionFileForDesign(opts.sessionDir, designId);
  if (!existsSync(file)) return [];
  const manager = SessionManager.open(file, opts.sessionDir, cwd);
  return replayEntries(designId, manager.getEntries());
}

export function appendSessionChatMessage(
  opts: SessionChatStoreOptions,
  input: ChatAppendInput,
): ChatMessageRow {
  const manager = openSession(opts, input.designId);
  const seq = listSessionChatMessages(opts, input.designId).length;
  const stored: StoredChatMessage = {
    schemaVersion: 1,
    id: seq,
    seq,
    kind: input.kind,
    payload: input.payload ?? {},
    snapshotId: input.snapshotId ?? null,
  };
  const entryId = manager.appendCustomEntry(CHAT_MESSAGE_CUSTOM_TYPE, stored);
  const entry = manager.getEntry(entryId);
  flushSession(manager);
  return {
    schemaVersion: 1,
    id: stored.id,
    designId: input.designId,
    seq,
    kind: input.kind,
    payload: stored.payload,
    snapshotId: stored.snapshotId,
    createdAt: entry?.timestamp ?? new Date().toISOString(),
  };
}

export function appendSessionToolStatus(
  opts: SessionChatStoreOptions,
  input: ChatToolStatusUpdate,
): void {
  const manager = openSession(opts, input.designId);
  const stored: StoredToolStatusUpdate = {
    schemaVersion: 1,
    seq: input.seq,
    status: input.status,
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  };
  manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, stored);
  flushSession(manager);
}

export function seedSessionChatFromSnapshots(
  opts: SessionChatStoreOptions,
  designId: string,
): number {
  if (listSessionChatMessages(opts, designId).length > 0) return 0;

  const snapshots = listSnapshots(opts.db, designId).slice().reverse();
  let inserted = 0;
  for (const snapshot of snapshots) {
    if (typeof snapshot.prompt === 'string' && snapshot.prompt.trim().length > 0) {
      appendSessionChatMessage(opts, {
        designId,
        kind: 'user',
        payload: { text: snapshot.prompt },
      });
      inserted += 1;
    }
    appendSessionChatMessage(opts, {
      designId,
      kind: 'artifact_delivered',
      payload: { createdAt: snapshot.createdAt },
      snapshotId: snapshot.id,
    });
    inserted += 1;
  }
  return inserted;
}
