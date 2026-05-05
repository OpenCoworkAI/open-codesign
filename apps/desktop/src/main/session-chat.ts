import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type DesignSessionBriefV1,
  normalizeDesignSessionBrief,
  SessionManager,
} from '@open-codesign/core';
import type {
  ChatAppendInput,
  ChatMessageKind,
  ChatMessageRow,
  ChatToolCallPayload,
  CommentCreateInput,
  CommentRow,
  CommentUpdateInput,
  DesignRunPreferencesV1,
} from '@open-codesign/shared';
import {
  CodesignError,
  CommentRowV1,
  DesignRunPreferencesV1 as DesignRunPreferencesV1Schema,
} from '@open-codesign/shared';
import { compactToolResultForHistory } from './ipc/tool-log';
import { type Database, getDesign, listSnapshots, touchDesignActivity } from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';

export const CHAT_MESSAGE_CUSTOM_TYPE = 'open-codesign.chat.message';
export const CHAT_TOOL_STATUS_CUSTOM_TYPE = 'open-codesign.chat.tool_status';
export const COMMENT_CUSTOM_TYPE = 'open-codesign.comment.v1';
export const CONTEXT_BRIEF_CUSTOM_TYPE = 'open-codesign.context.brief.v1';
export const RUN_PREFERENCES_CUSTOM_TYPE = 'open-codesign.context.run_preferences.v1';

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

type StoredCommentEvent =
  | {
      schemaVersion: 1;
      action: 'add';
      row: CommentRow;
    }
  | {
      schemaVersion: 1;
      action: 'update';
      id: string;
      patch: CommentUpdateInput;
    }
  | {
      schemaVersion: 1;
      action: 'remove';
      id: string;
    }
  | {
      schemaVersion: 1;
      action: 'mark-applied';
      ids: string[];
      snapshotId: string;
    };

interface StoredDesignBrief {
  schemaVersion: 1;
  brief: DesignSessionBriefV1;
}

interface StoredRunPreferences {
  schemaVersion: 1;
  preferences: DesignRunPreferencesV1;
}

interface AppendSessionChatMessageOptions {
  touchActivity?: boolean;
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

function parseCommentEvent(value: unknown): StoredCommentEvent | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  const action = value['action'];
  if (action === 'add') {
    const parsed = CommentRowV1.safeParse(value['row']);
    if (!parsed.success) return null;
    return { schemaVersion: 1, action, row: parsed.data };
  }
  if (action === 'update') {
    if (typeof value['id'] !== 'string') return null;
    const patch = value['patch'];
    if (!isRecord(patch)) return null;
    const nextPatch: CommentUpdateInput = {};
    if (typeof patch['text'] === 'string') nextPatch.text = patch['text'];
    if (
      patch['status'] === 'pending' ||
      patch['status'] === 'applied' ||
      patch['status'] === 'dismissed'
    ) {
      nextPatch.status = patch['status'];
    }
    if (Object.keys(nextPatch).length === 0) return null;
    return { schemaVersion: 1, action, id: value['id'], patch: nextPatch };
  }
  if (action === 'remove') {
    if (typeof value['id'] !== 'string') return null;
    return { schemaVersion: 1, action, id: value['id'] };
  }
  if (action === 'mark-applied') {
    if (!Array.isArray(value['ids']) || !value['ids'].every((id) => typeof id === 'string')) {
      return null;
    }
    if (typeof value['snapshotId'] !== 'string' || value['snapshotId'].length === 0) return null;
    return {
      schemaVersion: 1,
      action,
      ids: value['ids'],
      snapshotId: value['snapshotId'],
    };
  }
  return null;
}

function parseStoredBrief(value: unknown): StoredDesignBrief | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  const rawBrief = value['brief'];
  if (!isRecord(rawBrief)) return null;
  const designId = typeof rawBrief['designId'] === 'string' ? rawBrief['designId'] : '';
  const designName = typeof rawBrief['designName'] === 'string' ? rawBrief['designName'] : '';
  if (designId.length === 0 || designName.length === 0) return null;
  const now = typeof rawBrief['updatedAt'] === 'string' ? rawBrief['updatedAt'] : undefined;
  const brief = normalizeDesignSessionBrief(rawBrief, {
    designId,
    designName,
    ...(now !== undefined ? { now } : {}),
  });
  return brief === null ? null : { schemaVersion: 1, brief };
}

function parseStoredRunPreferences(value: unknown): StoredRunPreferences | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  const result = DesignRunPreferencesV1Schema.safeParse(value['preferences']);
  if (!result.success) return null;
  return { schemaVersion: 1, preferences: result.data };
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
      if (idx < 0) continue;
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

function replayCommentEvents(designId: string, entries: unknown[]): CommentRow[] {
  const rows = new Map<string, CommentRow>();
  for (const raw of entries) {
    const entry = raw as CustomEntryLike;
    if (entry.type !== 'custom' || entry.customType !== COMMENT_CUSTOM_TYPE) continue;
    const event = parseCommentEvent(entry.data);
    if (event === null) {
      throw new CodesignError('Malformed stored comment entry', 'IPC_DB_ERROR');
    }
    if (event.action === 'add') {
      if (event.row.designId === designId) rows.set(event.row.id, event.row);
      continue;
    }
    if (event.action === 'update') {
      const row = rows.get(event.id);
      if (row !== undefined) rows.set(event.id, { ...row, ...event.patch });
      continue;
    }
    if (event.action === 'remove') {
      rows.delete(event.id);
      continue;
    }
    for (const id of event.ids) {
      const row = rows.get(id);
      if (row !== undefined) {
        rows.set(id, {
          ...row,
          status: 'applied',
          appliedInSnapshotId: event.snapshotId,
        });
      }
    }
  }
  return Array.from(rows.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listSessionComments(
  opts: SessionChatStoreOptions,
  designId: string,
  snapshotId?: string,
): CommentRow[] {
  const cwd = resolveSessionCwd(opts, designId);
  const file = sessionFileForDesign(opts.sessionDir, designId);
  if (!existsSync(file)) return [];
  const manager = SessionManager.open(file, opts.sessionDir, cwd);
  const rows = replayCommentEvents(designId, manager.getEntries());
  return snapshotId === undefined ? rows : rows.filter((row) => row.snapshotId === snapshotId);
}

export function listPendingSessionCommentEdits(
  opts: SessionChatStoreOptions,
  designId: string,
): CommentRow[] {
  return listSessionComments(opts, designId).filter(
    (row) => row.kind === 'edit' && row.status === 'pending',
  );
}

function appendCommentEvent(
  opts: SessionChatStoreOptions,
  designId: string,
  event: StoredCommentEvent,
): void {
  const manager = openSession(opts, designId);
  const entryId = manager.appendCustomEntry(COMMENT_CUSTOM_TYPE, event);
  const entry = manager.getEntry(entryId);
  flushSession(manager);
  const createdAt = entry?.timestamp ?? new Date().toISOString();
  touchDesignActivity(opts.db, designId, createdAt);
}

export function appendSessionComment(
  opts: SessionChatStoreOptions,
  input: CommentCreateInput,
): CommentRow {
  const createdAt = new Date().toISOString();
  const row = CommentRowV1.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    designId: input.designId,
    snapshotId: input.snapshotId,
    kind: input.kind,
    selector: input.selector,
    tag: input.tag,
    outerHTML: input.outerHTML,
    rect: input.rect,
    text: input.text,
    status: 'pending',
    createdAt,
    appliedInSnapshotId: null,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.parentOuterHTML !== undefined ? { parentOuterHTML: input.parentOuterHTML } : {}),
  });
  appendCommentEvent(opts, input.designId, {
    schemaVersion: 1,
    action: 'add',
    row,
  });
  return row;
}

export function updateSessionComment(
  opts: SessionChatStoreOptions,
  designId: string,
  id: string,
  patch: CommentUpdateInput,
): CommentRow | null {
  const existing = listSessionComments(opts, designId).find((row) => row.id === id);
  if (existing === undefined) return null;
  appendCommentEvent(opts, designId, { schemaVersion: 1, action: 'update', id, patch });
  return { ...existing, ...patch };
}

export function removeSessionComment(
  opts: SessionChatStoreOptions,
  designId: string,
  id: string,
): boolean {
  const exists = listSessionComments(opts, designId).some((row) => row.id === id);
  if (!exists) return false;
  appendCommentEvent(opts, designId, { schemaVersion: 1, action: 'remove', id });
  return true;
}

export function markSessionCommentsApplied(
  opts: SessionChatStoreOptions,
  designId: string,
  ids: string[],
  snapshotId: string,
): CommentRow[] {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];
  const rows = listSessionComments(opts, designId);
  const existingIds = new Set(rows.map((row) => row.id));
  const presentIds = uniqueIds.filter((id) => existingIds.has(id));
  if (presentIds.length === 0) return [];
  appendCommentEvent(opts, designId, {
    schemaVersion: 1,
    action: 'mark-applied',
    ids: presentIds,
    snapshotId,
  });
  return listSessionComments(opts, designId).filter((row) => presentIds.includes(row.id));
}

export function appendSessionChatMessage(
  opts: SessionChatStoreOptions,
  input: ChatAppendInput,
  options: AppendSessionChatMessageOptions = {},
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
  const createdAt = entry?.timestamp ?? new Date().toISOString();
  if (options.touchActivity !== false) {
    touchDesignActivity(opts.db, input.designId, createdAt);
  }
  return {
    schemaVersion: 1,
    id: stored.id,
    designId: input.designId,
    seq,
    kind: input.kind,
    payload: stored.payload,
    snapshotId: stored.snapshotId,
    createdAt,
  };
}

export function appendSessionToolStatus(
  opts: SessionChatStoreOptions,
  input: ChatToolStatusUpdate,
): void {
  const row = listSessionChatMessages(opts, input.designId).find(
    (message) => message.seq === input.seq,
  );
  if (row?.kind !== 'tool_call') return;
  const manager = openSession(opts, input.designId);
  const toolName =
    typeof (row.payload as { toolName?: unknown } | null)?.toolName === 'string'
      ? ((row.payload as { toolName: string }).toolName ?? 'unknown')
      : 'unknown';
  const stored: StoredToolStatusUpdate = {
    schemaVersion: 1,
    seq: input.seq,
    status: input.status,
    ...(input.result !== undefined
      ? { result: compactToolResultForHistory(toolName, input.result) }
      : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  };
  const entryId = manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, stored);
  const entry = manager.getEntry(entryId);
  flushSession(manager);
  touchDesignActivity(opts.db, input.designId, entry?.timestamp ?? new Date().toISOString());
}

export function readSessionDesignBrief(
  opts: SessionChatStoreOptions,
  designId: string,
): DesignSessionBriefV1 | null {
  const cwd = resolveSessionCwd(opts, designId);
  const file = sessionFileForDesign(opts.sessionDir, designId);
  if (!existsSync(file)) return null;
  const manager = SessionManager.open(file, opts.sessionDir, cwd);
  const entries = manager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as CustomEntryLike | undefined;
    if (entry?.type !== 'custom' || entry.customType !== CONTEXT_BRIEF_CUSTOM_TYPE) continue;
    const stored = parseStoredBrief(entry.data);
    if (stored !== null) return stored.brief;
  }
  return null;
}

export function appendSessionDesignBrief(
  opts: SessionChatStoreOptions,
  designId: string,
  brief: DesignSessionBriefV1,
): void {
  const manager = openSession(opts, designId);
  const stored: StoredDesignBrief = { schemaVersion: 1, brief };
  manager.appendCustomEntry(CONTEXT_BRIEF_CUSTOM_TYPE, stored);
  flushSession(manager);
}

export function readSessionRunPreferences(
  opts: SessionChatStoreOptions,
  designId: string,
): DesignRunPreferencesV1 | null {
  const cwd = resolveSessionCwd(opts, designId);
  const file = sessionFileForDesign(opts.sessionDir, designId);
  if (!existsSync(file)) return null;
  const manager = SessionManager.open(file, opts.sessionDir, cwd);
  const entries = manager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as CustomEntryLike | undefined;
    if (entry?.type !== 'custom' || entry.customType !== RUN_PREFERENCES_CUSTOM_TYPE) continue;
    const stored = parseStoredRunPreferences(entry.data);
    if (stored !== null) return stored.preferences;
  }
  return null;
}

export function appendSessionRunPreferences(
  opts: SessionChatStoreOptions,
  designId: string,
  preferences: DesignRunPreferencesV1,
): void {
  const parsed = DesignRunPreferencesV1Schema.parse(preferences);
  const manager = openSession(opts, designId);
  const stored: StoredRunPreferences = { schemaVersion: 1, preferences: parsed };
  manager.appendCustomEntry(RUN_PREFERENCES_CUSTOM_TYPE, stored);
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
      appendSessionChatMessage(
        opts,
        {
          designId,
          kind: 'user',
          payload: { text: snapshot.prompt },
        },
        { touchActivity: false },
      );
      inserted += 1;
    }
    appendSessionChatMessage(
      opts,
      {
        designId,
        kind: 'artifact_delivered',
        payload: { createdAt: snapshot.createdAt },
        snapshotId: snapshot.id,
      },
      { touchActivity: false },
    );
    inserted += 1;
  }
  return inserted;
}
