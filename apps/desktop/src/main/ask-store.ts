import {
  appendFile,
  type FileHandle,
  mkdir,
  open,
  readFile,
  stat,
  truncate,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AskInput, type AskResult, validateAskInput } from '@open-codesign/core';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export interface AskRequestPayload {
  requestId: string;
  sessionId: string;
  runId?: string;
  designId?: string;
  input: AskInput;
}
export interface AskHistoryEntry extends AskRequestPayload {
  schemaVersion: 1;
  status: 'pending' | 'answered' | 'cancelled' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  result?: AskResult;
}
export interface AskHistoryFilter {
  runId?: string;
  designId?: string;
}
function badInput(message: string): never {
  throw new CodesignError(message, ERROR_CODES.IPC_BAD_INPUT);
}
function normalizeResult(input: AskInput, result: AskResult): AskResult {
  if (result.status === 'cancelled') {
    if (result.answers.length !== 0) badInput('Cancelled ask must have no answers');
    return { status: 'cancelled', answers: [] };
  }
  if (result.answers.length !== input.questions.length)
    badInput('ask:resolve requires an answer for each question');
  const values = new Map(result.answers.map((answer) => [answer.questionId, answer.value]));
  if (values.size !== result.answers.length)
    badInput('ask:resolve contains duplicate question IDs');
  const answers = input.questions.map((question) => {
    if (!values.has(question.id)) badInput(`ask:resolve missing question "${question.id}"`);
    const value = values.get(question.id) ?? null;
    let valid = value === null;
    switch (question.type) {
      case 'freeform':
        valid ||= typeof value === 'string';
        break;
      case 'file':
        valid ||= question.multiple
          ? Array.isArray(value) && value.every((item) => typeof item === 'string')
          : typeof value === 'string';
        break;
      case 'slider':
        valid ||=
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= question.min &&
          value <= question.max;
        break;
      case 'text-options':
        valid ||= question.multi
          ? Array.isArray(value) && value.every((item) => question.options.includes(item))
          : typeof value === 'string' && question.options.includes(value);
        break;
      case 'svg-options':
        valid ||=
          typeof value === 'string' && question.options.some((option) => option.id === value);
        break;
    }
    if (!valid) badInput(`ask:resolve invalid answer for question "${question.id}"`);
    return {
      questionId: question.id,
      value:
        question.type === 'text-options' && Array.isArray(value)
          ? [...new Set(value)].sort()
          : value,
    };
  });
  return { status: 'answered', answers };
}
function parseRecord(raw: unknown): AskHistoryEntry {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid ask journal record');
  const row = raw as AskHistoryEntry;
  if (
    row.schemaVersion !== 1 ||
    typeof row.requestId !== 'string' ||
    typeof row.sessionId !== 'string' ||
    (row.runId !== undefined && typeof row.runId !== 'string') ||
    (row.designId !== undefined && typeof row.designId !== 'string') ||
    !Number.isFinite(row.createdAt) ||
    !Number.isFinite(row.updatedAt) ||
    !['pending', 'answered', 'cancelled', 'interrupted'].includes(row.status) ||
    !validateAskInput(row.input).ok
  ) {
    throw new Error('Invalid or unsupported ask journal record');
  }
  if (row.status === 'answered' || row.status === 'cancelled') {
    if (row.result?.status !== row.status || !Array.isArray(row.result.answers))
      throw new Error('Invalid ask journal result');
    normalizeResult(row.input, row.result);
  }
  return row;
}
/** One host owns this append-only journal; runtime resolvers deliberately never live on disk. */
export class AskStore {
  private readonly entries = new Map<string, AskHistoryEntry>();
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private needsNewline = false;
  private writeFailure: Error | undefined;
  constructor(readonly path: string) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.loaded) {
        if (this.writeFailure) throw this.writeFailure;
        await this.load();
      }
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      text = '';
    }
    this.entries.clear();
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? '';
      if (!line.trim()) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (error) {
        if (index !== lines.length - 1 || text.endsWith('\n')) throw error;
        // Only an incomplete final append is recoverable; do not hide mid-journal corruption.
        text = `${lines.slice(0, index).join('\n')}${index > 0 ? '\n' : ''}`;
        await truncate(this.path, Buffer.byteLength(text));
        break;
      }
      const row = parseRecord(raw);
      this.entries.set(row.requestId, row);
    }
    this.needsNewline = text.length > 0 && !text.endsWith('\n');
    for (const entry of this.entries.values()) {
      if (entry.status !== 'pending') continue;
      await this.append({ ...entry, status: 'interrupted', updatedAt: Date.now() });
    }
    this.loaded = true;
  }
  private async rollback(offset: number): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(this.path, 'r+');
    } catch (error) {
      if (offset === 0 && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    try {
      await handle.truncate(offset);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private async append(entry: AskHistoryEntry): Promise<void> {
    if (this.writeFailure) throw this.writeFailure;
    await mkdir(dirname(this.path), { recursive: true });
    let offset = 0;
    try {
      const info = await stat(this.path);
      if (!info.isFile()) throw new Error('Ask journal path is not a regular file');
      offset = info.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await appendFile(this.path, `${this.needsNewline ? '\n' : ''}${JSON.stringify(entry)}\n`, {
        encoding: 'utf8',
        flush: true,
      });
    } catch (error) {
      // Even a rejected append may have written a complete record before fsync failed.
      // Never let a retry extend unacknowledged bytes into the middle of the journal.
      try {
        await this.rollback(offset);
      } catch (rollbackError) {
        this.writeFailure = new Error(
          'Ask journal rollback failed; restart the app before answering questions.',
          {
            cause: new AggregateError([error, rollbackError]),
          },
        );
        throw this.writeFailure;
      }
      throw error;
    }
    this.needsNewline = false;
    this.entries.set(entry.requestId, entry);
  }
  create(request: AskRequestPayload): Promise<AskHistoryEntry> {
    const snapshot = structuredClone(request);
    return this.serialize(async () => {
      if (this.entries.has(snapshot.requestId)) badInput('Duplicate ask request ID');
      const valid = validateAskInput(snapshot.input);
      if (!valid.ok) badInput(`Invalid ask input: ${valid.reason}`);
      const now = Date.now();
      const entry: AskHistoryEntry = {
        ...snapshot,
        schemaVersion: 1,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      await this.append(entry);
      return structuredClone(entry);
    });
  }
  settle(requestId: string, result: AskResult): Promise<AskHistoryEntry> {
    const snapshot = structuredClone(result);
    return this.serialize(async () => {
      const previous = this.entries.get(requestId);
      if (!previous) badInput(`ask:resolve unknown requestId "${requestId}"`);
      const normalized = normalizeResult(previous.input, snapshot);
      if (previous.status !== 'pending') {
        if (JSON.stringify(previous.result) === JSON.stringify(normalized))
          return structuredClone(previous);
        badInput(`ask:resolve request "${requestId}" is already ${previous.status}`);
      }
      const entry: AskHistoryEntry = {
        ...previous,
        status: normalized.status,
        result: normalized,
        updatedAt: Date.now(),
      };
      await this.append(entry);
      return structuredClone(entry);
    });
  }
  history(filter: AskHistoryFilter = {}): Promise<AskHistoryEntry[]> {
    return this.serialize(async () =>
      structuredClone(
        [...this.entries.values()].filter(
          (entry) =>
            (filter.runId === undefined || (entry.runId ?? entry.sessionId) === filter.runId) &&
            (filter.designId === undefined || entry.designId === filter.designId),
        ),
      ),
    );
  }
}
