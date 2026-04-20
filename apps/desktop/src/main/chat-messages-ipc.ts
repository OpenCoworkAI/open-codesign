/**
 * IPC handlers for the Sidebar v2 chat_messages table.
 *
 * Channels are namespaced chat:v1:* and independent from snapshots:v1:*
 * so that a future chat-only schema migration can bump version without
 * touching snapshot callers.
 */

import type { ChatAppendInput, ChatMessageKind, ChatMessageRow } from '@open-codesign/shared';
import { CodesignError } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import { appendChatMessage, listChatMessages, seedChatFromSnapshots } from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('chat-messages-ipc');

const VALID_KINDS: ChatMessageKind[] = [
  'user',
  'assistant_text',
  'tool_call',
  'artifact_delivered',
  'error',
];

function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, 'IPC_BAD_INPUT');
  }
}

function parseDesignId(raw: unknown, channel: string): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`${channel} expects an object with designId`, 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, channel);
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  return r['designId'] as string;
}

function parseAppendInput(raw: unknown): ChatAppendInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError('chat:v1:append expects an object payload', 'IPC_BAD_INPUT');
  }
  const r = raw as Record<string, unknown>;
  requireSchemaV1(r, 'chat:v1:append');
  if (typeof r['designId'] !== 'string' || r['designId'].trim().length === 0) {
    throw new CodesignError('designId must be a non-empty string', 'IPC_BAD_INPUT');
  }
  const kind = r['kind'];
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as ChatMessageKind)) {
    throw new CodesignError(
      `kind must be one of: ${VALID_KINDS.join(', ')}`,
      'IPC_BAD_INPUT',
    );
  }
  const snapshotId = r['snapshotId'];
  if (snapshotId !== undefined && snapshotId !== null && typeof snapshotId !== 'string') {
    throw new CodesignError('snapshotId must be a string, null, or absent', 'IPC_BAD_INPUT');
  }
  return {
    designId: r['designId'],
    kind: kind as ChatMessageKind,
    payload: r['payload'] ?? {},
    ...(snapshotId !== undefined ? { snapshotId: snapshotId as string | null } : {}),
  };
}

export const CHAT_MESSAGES_CHANNELS_V1 = [
  'chat:v1:list',
  'chat:v1:append',
  'chat:v1:seed-from-snapshots',
] as const;

export function registerChatMessagesIpc(db: Database): void {
  ipcMain.handle('chat:v1:list', (_e: unknown, raw: unknown): ChatMessageRow[] => {
    const designId = parseDesignId(raw, 'chat:v1:list');
    return listChatMessages(db, designId);
  });

  ipcMain.handle('chat:v1:append', (_e: unknown, raw: unknown): ChatMessageRow => {
    const input = parseAppendInput(raw);
    try {
      const row = appendChatMessage(db, input);
      logger.info('chat.append', { designId: input.designId, seq: row.seq, kind: input.kind });
      return row;
    } catch (err) {
      logger.error('chat.append.fail', {
        designId: input.designId,
        kind: input.kind,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new CodesignError('Failed to append chat message', 'IPC_DB_ERROR', { cause: err });
    }
  });

  ipcMain.handle('chat:v1:seed-from-snapshots', (_e: unknown, raw: unknown): { inserted: number } => {
    const designId = parseDesignId(raw, 'chat:v1:seed-from-snapshots');
    const inserted = seedChatFromSnapshots(db, designId);
    if (inserted > 0) logger.info('chat.seeded', { designId, inserted });
    return { inserted };
  });
}

export function registerChatMessagesUnavailableIpc(reason: string): void {
  const message = `Chat history is unavailable. ${reason}`;
  const fail = (): never => {
    throw new CodesignError(message, 'SNAPSHOTS_UNAVAILABLE');
  };
  for (const channel of CHAT_MESSAGES_CHANNELS_V1) {
    ipcMain.handle(channel, fail);
  }
}
