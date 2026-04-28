/**
 * IPC handlers for the Workstream D comments table.
 *
 * Channels are namespaced comments:v1:* so that a future schema migration
 * can bump version without touching snapshot or chat_messages callers.
 */

import type {
  CommentCreateInput,
  CommentKind,
  CommentRow,
  CommentStatus,
} from '@open-codesign/shared';
import { CodesignError, ComponentSelectionV1, ERROR_CODES } from '@open-codesign/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import {
  createComment,
  deleteComment,
  listComments,
  listPendingEdits,
  markCommentsApplied,
  updateComment,
} from './snapshots-db';

type Database = BetterSqlite3.Database;

const logger = getLogger('comments-ipc');

const VALID_KINDS: CommentKind[] = ['note', 'edit'];
const VALID_STATUSES: CommentStatus[] = ['pending', 'applied', 'dismissed'];

function requireSchemaV1(r: Record<string, unknown>, channel: string): void {
  if (r['schemaVersion'] !== 1) {
    throw new CodesignError(`${channel} requires schemaVersion: 1`, ERROR_CODES.IPC_BAD_INPUT);
  }
}

function asObject(raw: unknown, channel: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`${channel} expects an object payload`, ERROR_CODES.IPC_BAD_INPUT);
  }
  return raw as Record<string, unknown>;
}

function parseNonEmptyString(r: Record<string, unknown>, field: string, channel: string): string {
  const v = r[field];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new CodesignError(
      `${channel}: ${field} must be a non-empty string`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  return v;
}

function parseRect(raw: unknown, channel: string): CommentCreateInput['rect'] {
  if (typeof raw !== 'object' || raw === null) {
    throw new CodesignError(`${channel}: rect must be an object`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const fields = ['top', 'left', 'width', 'height'] as const;
  const out: Record<string, number> = {};
  for (const f of fields) {
    const v = r[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new CodesignError(
        `${channel}: rect.${f} must be a finite number`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    out[f] = v;
  }
  return out as CommentCreateInput['rect'];
}

function parseDesignId(raw: unknown, channel: string): string {
  const r = asObject(raw, channel);
  requireSchemaV1(r, channel);
  return parseNonEmptyString(r, 'designId', channel);
}

function parseAddInput(raw: unknown): CommentCreateInput {
  const channel = 'comments:v1:add';
  const r = asObject(raw, channel);
  requireSchemaV1(r, channel);
  const kind = r['kind'];
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as CommentKind)) {
    throw new CodesignError(
      `${channel}: kind must be one of ${VALID_KINDS.join(', ')}`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const text = r['text'];
  if (typeof text !== 'string') {
    throw new CodesignError(`${channel}: text must be a string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const outerHTML = r['outerHTML'];
  if (typeof outerHTML !== 'string') {
    throw new CodesignError(`${channel}: outerHTML must be a string`, ERROR_CODES.IPC_BAD_INPUT);
  }
  const scopeRaw = r['scope'];
  let scope: 'element' | 'global' = 'element';
  if (scopeRaw !== undefined) {
    if (scopeRaw !== 'element' && scopeRaw !== 'global') {
      throw new CodesignError(
        `${channel}: scope must be 'element' or 'global'`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    scope = scopeRaw;
  }
  const parentRaw = r['parentOuterHTML'];
  if (parentRaw !== undefined && parentRaw !== null && typeof parentRaw !== 'string') {
    throw new CodesignError(
      `${channel}: parentOuterHTML must be a string when present`,
      ERROR_CODES.IPC_BAD_INPUT,
    );
  }
  const parentOuterHTML =
    typeof parentRaw === 'string' && parentRaw.length > 0 ? parentRaw : undefined;
  // U9: optional component metadata captured by the React inspector. Validate
  // strictly via zod so a corrupt payload from the renderer fails IPC
  // immediately rather than poisoning the DB row.
  const componentRaw = r['componentSelection'];
  let componentSelection: CommentCreateInput['componentSelection'];
  if (componentRaw !== undefined && componentRaw !== null) {
    const parsed = ComponentSelectionV1.safeParse(componentRaw);
    if (!parsed.success) {
      throw new CodesignError(
        `${channel}: componentSelection failed schema validation`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    componentSelection = parsed.data;
  }
  return {
    designId: parseNonEmptyString(r, 'designId', channel),
    snapshotId: parseNonEmptyString(r, 'snapshotId', channel),
    kind: kind as CommentKind,
    selector: parseNonEmptyString(r, 'selector', channel),
    tag: parseNonEmptyString(r, 'tag', channel),
    outerHTML,
    rect: parseRect(r['rect'], channel),
    text,
    scope,
    ...(parentOuterHTML !== undefined ? { parentOuterHTML } : {}),
    ...(componentSelection !== undefined ? { componentSelection } : {}),
  };
}

export const COMMENTS_CHANNELS_V1 = [
  'comments:v1:add',
  'comments:v1:list',
  'comments:v1:list-pending-edits',
  'comments:v1:update',
  'comments:v1:remove',
  'comments:v1:mark-applied',
] as const;

export function registerCommentsIpc(db: Database): void {
  ipcMain.handle('comments:v1:add', (_e: unknown, raw: unknown): CommentRow => {
    const input = parseAddInput(raw);
    try {
      const row = createComment(db, input);
      logger.info('comments.add', {
        designId: input.designId,
        snapshotId: input.snapshotId,
        kind: input.kind,
      });
      return row;
    } catch (err) {
      logger.error('comments.add.fail', {
        designId: input.designId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw new CodesignError('Failed to create comment', ERROR_CODES.IPC_DB_ERROR, { cause: err });
    }
  });

  ipcMain.handle('comments:v1:list', (_e: unknown, raw: unknown): CommentRow[] => {
    const channel = 'comments:v1:list';
    const r = asObject(raw, channel);
    requireSchemaV1(r, channel);
    const designId = parseNonEmptyString(r, 'designId', channel);
    const snapshotId = r['snapshotId'];
    if (snapshotId !== undefined && snapshotId !== null && typeof snapshotId !== 'string') {
      throw new CodesignError(
        `${channel}: snapshotId must be a string, null, or absent`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    return typeof snapshotId === 'string'
      ? listComments(db, designId, snapshotId)
      : listComments(db, designId);
  });

  ipcMain.handle('comments:v1:list-pending-edits', (_e: unknown, raw: unknown): CommentRow[] => {
    const designId = parseDesignId(raw, 'comments:v1:list-pending-edits');
    return listPendingEdits(db, designId);
  });

  ipcMain.handle('comments:v1:update', (_e: unknown, raw: unknown): CommentRow | null => {
    const channel = 'comments:v1:update';
    const r = asObject(raw, channel);
    requireSchemaV1(r, channel);
    const id = parseNonEmptyString(r, 'id', channel);
    const patch: { text?: string; status?: CommentStatus } = {};
    if (r['text'] !== undefined) {
      if (typeof r['text'] !== 'string') {
        throw new CodesignError(`${channel}: text must be a string`, ERROR_CODES.IPC_BAD_INPUT);
      }
      patch.text = r['text'];
    }
    if (r['status'] !== undefined) {
      const s = r['status'];
      if (typeof s !== 'string' || !VALID_STATUSES.includes(s as CommentStatus)) {
        throw new CodesignError(
          `${channel}: status must be one of ${VALID_STATUSES.join(', ')}`,
          ERROR_CODES.IPC_BAD_INPUT,
        );
      }
      patch.status = s as CommentStatus;
    }
    return updateComment(db, id, patch);
  });

  ipcMain.handle('comments:v1:remove', (_e: unknown, raw: unknown): { removed: boolean } => {
    const channel = 'comments:v1:remove';
    const r = asObject(raw, channel);
    requireSchemaV1(r, channel);
    const id = parseNonEmptyString(r, 'id', channel);
    const removed = deleteComment(db, id);
    if (removed) logger.info('comments.remove', { id });
    return { removed };
  });

  ipcMain.handle('comments:v1:mark-applied', (_e: unknown, raw: unknown): CommentRow[] => {
    const channel = 'comments:v1:mark-applied';
    const r = asObject(raw, channel);
    requireSchemaV1(r, channel);
    const snapshotId = parseNonEmptyString(r, 'snapshotId', channel);
    const ids = r['ids'];
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || x.length === 0)) {
      throw new CodesignError(
        `${channel}: ids must be an array of non-empty strings`,
        ERROR_CODES.IPC_BAD_INPUT,
      );
    }
    const rows = markCommentsApplied(db, ids as string[], snapshotId);
    if (rows.length > 0) logger.info('comments.mark-applied', { count: rows.length, snapshotId });
    return rows;
  });
}

export function registerCommentsUnavailableIpc(reason: string): void {
  const message = `Comments are unavailable. ${reason}`;
  const fail = (): never => {
    throw new CodesignError(message, ERROR_CODES.SNAPSHOTS_UNAVAILABLE);
  };
  for (const channel of COMMENTS_CHANNELS_V1) {
    ipcMain.handle(channel, fail);
  }
}
