import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentStreamEvent, GenerateResponse } from '../preload/index';
import { projectRunEventToChat } from './run-event-chat';
import {
  appendSessionActiveMessage,
  listSessionActiveMessages,
  listSessionChatMessages,
  type SessionChatStoreOptions,
} from './session-chat';
import { createDesign, initSnapshotsDb, updateDesignWorkspace } from './snapshots-db';

let root: string;
let designId: string;
let opts: SessionChatStoreOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codesign-run-projection-'));
  const db = initSnapshotsDb(path.join(root, 'design-store.json'));
  const design = createDesign(db, 'Run projection');
  designId = design.id;
  updateDesignWorkspace(db, designId, root);
  opts = { db, sessionDir: db.sessionDir };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function event(seq: number, extra: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
  return {
    schemaVersion: 1,
    type: 'turn_end',
    generationId: 'run-a',
    runId: 'run-a',
    designId,
    seq,
    ...extra,
  };
}

function response(message = 'Finished'): GenerateResponse {
  return {
    message,
    inputTokens: 1,
    outputTokens: 2,
    costUsd: 0,
    artifacts: [
      {
        id: 'artifact-a',
        type: 'html',
        title: 'A page',
        content: '<main>Hello</main>',
        designParams: [],
        entryPath: 'screens/Home.jsx',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function rows() {
  return listSessionChatMessages(opts, designId);
}

function file() {
  return readFile(path.join(opts.sessionDir, `${designId}.jsonl`), 'utf8');
}

function project(events: AgentStreamEvent[]) {
  for (const item of events) projectRunEventToChat(opts, item);
}

describe('projectRunEventToChat', () => {
  it('ignores transient and unjournaled events', () => {
    projectRunEventToChat(opts, {
      type: 'turn_end',
      designId,
      generationId: 'run-a',
      finalText: 'not committed',
    });
    project([
      event(1, { type: 'turn_start' }),
      event(2, { type: 'text_delta', delta: 'streaming' }),
      event(3, { type: 'agent_end' }),
    ]);
    expect(rows()).toEqual([]);
  });

  it('persists a turn once and replays it without adding rows or file entries', async () => {
    const turn = event(1, { finalText: '  A useful reply  ' });
    project([turn]);
    const before = await file();
    project([turn, turn]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.payload).toMatchObject({
      text: 'A useful reply',
      runId: 'run-a',
      runEventKey: 'run-a:1',
    });
    expect(await file()).toBe(before);
  });

  it('preserves equal prose in distinct turns while replay remains idempotent', async () => {
    const history = [
      event(1, { finalText: 'A' }),
      event(2, { finalText: 'A' }),
      event(3, { finalText: 'B' }),
    ];
    project(history);
    expect(rows().map((row) => row.payload)).toMatchObject([
      { text: 'A' },
      { text: 'A' },
      { text: 'B' },
    ]);
    const before = await file();
    project(history);
    expect(rows()).toHaveLength(3);
    expect(await file()).toBe(before);
  });

  it('replays a tool start/result once, preserving the result, duration and error', async () => {
    const history = [
      event(1, {
        type: 'tool_call_start',
        toolName: 'preview',
        toolCallId: 'tool-a',
        args: { path: 'App.jsx' },
      }),
      event(2, {
        type: 'tool_call_result',
        toolName: 'preview',
        toolCallId: 'tool-a',
        status: 'error',
        result: { problems: ['missing asset'] },
        durationMs: 42,
        message: 'Missing image',
      }),
    ];
    project(history);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.payload).toMatchObject({
      toolName: 'preview',
      status: 'error',
      result: { problems: ['missing asset'] },
      durationMs: 42,
      error: { message: 'Missing image' },
    });
    const before = await file();
    project(history);
    expect(await file()).toBe(before);
    const reopened = initSnapshotsDb(path.join(root, 'design-store.json'));
    expect(
      listSessionChatMessages({ db: reopened, sessionDir: reopened.sessionDir }, designId),
    ).toEqual(rows());
  });

  it("does not apply one run's tool result to another run with the same tool id", () => {
    project([
      event(1, { type: 'tool_call_start', toolName: 'read', toolCallId: 'same-id' }),
      event(1, {
        generationId: 'run-b',
        runId: 'run-b',
        type: 'tool_call_start',
        toolName: 'write',
        toolCallId: 'same-id',
      }),
      event(2, {
        generationId: 'run-b',
        runId: 'run-b',
        type: 'tool_call_result',
        toolCallId: 'same-id',
        status: 'done',
        result: 'written',
      }),
    ]);
    expect(rows().map((row) => row.payload)).toMatchObject([
      { runId: 'run-a', status: 'running' },
      { runId: 'run-b', status: 'done', result: 'written' },
    ]);
  });

  it.each([
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ] as const)('repairs a missed real tool result after the %s terminal fallback', async (outcome) => {
    const started = event(1, { type: 'tool_call_start', toolName: 'read', toolCallId: 'tool-a' });
    const actualResult = event(2, {
      type: 'tool_call_result',
      toolCallId: 'tool-a',
      status: 'done',
      result: { content: [{ type: 'text', text: 'result'.repeat(2_000) }] },
      durationMs: 42,
    });
    const terminal = event(3, {
      type: 'run_settled',
      outcome,
      message: 'Run settled before result projection was repaired',
    });
    // Simulate a committed result whose chat projection failed before settlement.
    project([started, terminal]);
    expect(rows()[0]?.payload).toMatchObject({
      status: outcome === 'completed' ? 'done' : 'error',
    });
    project([actualResult]);
    const repaired = rows()[0]?.payload as Record<string, unknown>;
    expect(repaired).toMatchObject({
      status: 'done',
      durationMs: 42,
      runResultEventKey: 'run-a:2',
    });
    expect(repaired['error']).toBeUndefined();
    expect(repaired['errorMessage']).toBeUndefined();
    const result = repaired['result'] as { content: Array<{ text: string }> };
    expect(result.content[0]?.text.length).toBeLessThan(12_000);
    const before = await file();
    project([started, actualResult, terminal, actualResult]);
    expect(await file()).toBe(before);
    const reopened = initSnapshotsDb(path.join(root, 'design-store.json'));
    opts = { db: reopened, sessionDir: reopened.sessionDir };
    project([actualResult]);
    expect(await file()).toBe(before);
  });

  it('restores an actual tool error after a completed-run fallback marked it done', async () => {
    const started = event(1, {
      type: 'tool_call_start',
      toolName: 'preview',
      toolCallId: 'tool-a',
    });
    const actualResult = event(2, {
      type: 'tool_call_result',
      toolCallId: 'tool-a',
      status: 'error',
      result: { failures: ['missing image'] },
      durationMs: 10,
      message: 'Actual tool failure',
    });
    const terminal = event(3, { type: 'run_settled', outcome: 'completed' });
    project([started, terminal, actualResult]);
    expect(rows()[0]?.payload).toMatchObject({
      status: 'error',
      result: { failures: ['missing image'] },
      durationMs: 10,
      error: { message: 'Actual tool failure' },
    });
    const before = await file();
    project([started, actualResult, terminal]);
    expect(await file()).toBe(before);
  });

  it('does not replay an older tool result over a newer committed result', async () => {
    const started = event(1, { type: 'tool_call_start', toolName: 'read', toolCallId: 'tool-a' });
    const first = event(2, {
      type: 'tool_call_result',
      toolCallId: 'tool-a',
      status: 'error',
      message: 'Old failure',
    });
    const latest = event(3, {
      type: 'tool_call_result',
      toolCallId: 'tool-a',
      status: 'done',
      result: 'final output',
    });
    project([started, first, latest]);
    expect(rows()[0]?.payload).toMatchObject({
      status: 'done',
      result: 'final output',
      runResultEventKey: 'run-a:3',
    });
    const before = await file();
    project([started, first, latest]);
    expect(await file()).toBe(before);
  });
  it('repairs a missing tool result projection when replay finds its start', () => {
    const result = event(2, {
      type: 'tool_call_result',
      toolCallId: 'tool-a',
      result: 'ok',
      status: 'done',
    });
    project([result]);
    expect(rows()).toEqual([]);
    project([
      event(1, { type: 'tool_call_start', toolCallId: 'tool-a', toolName: 'read' }),
      result,
    ]);
    expect(rows()[0]?.payload).toMatchObject({ status: 'done', result: 'ok' });
  });

  it('projects one fallback reply and artifact card from a terminal response', async () => {
    const terminal = event(1, { type: 'run_settled', outcome: 'completed', response: response() });
    project([terminal]);
    expect(rows().map((row) => row.kind)).toEqual(['assistant_text', 'artifact_delivered']);
    expect(rows()[0]?.payload).toMatchObject({ text: 'Finished', runEventKey: 'run-a:1:message' });
    expect(rows()[1]?.payload).toMatchObject({
      filename: 'screens/Home.jsx',
      runEventKey: 'run-a:1:artifact',
    });
    const before = await file();
    project([terminal, terminal]);
    expect(await file()).toBe(before);
  });

  it('does not duplicate already streamed prose when the terminal response arrives', async () => {
    const history = [
      event(1, { finalText: 'Finished' }),
      event(2, { type: 'run_settled', outcome: 'completed', response: response() }),
    ];
    project(history);
    expect(rows().map((row) => row.kind)).toEqual(['assistant_text', 'artifact_delivered']);
    const before = await file();
    project(history);
    expect(await file()).toBe(before);
  });

  it.each([
    'failed',
    'interrupted',
  ] as const)('settles unfinished tools and persists %s once', async (outcome) => {
    const history = [
      event(1, { type: 'tool_call_start', toolName: 'bash', toolCallId: 'tool-a' }),
      event(2, { type: 'run_settled', outcome, message: 'Worker stopped', code: 'RUN_STOPPED' }),
    ];
    project(history);
    expect(rows().map((row) => row.kind)).toEqual(['tool_call', 'error']);
    expect(rows()[0]?.payload).toMatchObject({
      status: 'error',
      error: { message: 'Worker stopped' },
    });
    expect(rows()[1]?.payload).toMatchObject({ message: 'Worker stopped', code: 'RUN_STOPPED' });
    const before = await file();
    project(history);
    expect(await file()).toBe(before);
  });

  it('records a structured error event exactly once', async () => {
    const failure = event(1, { type: 'error', message: 'Provider failed', code: 'PROVIDER_FAIL' });
    project([failure]);
    const before = await file();
    project([failure]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.payload).toMatchObject({ message: 'Provider failed', code: 'PROVIDER_FAIL' });
    expect(await file()).toBe(before);
  });

  it('keeps delivered active messages in stream order and projects receipts idempotently', async () => {
    const activeMessage = {
      schemaVersion: 1 as const,
      designId,
      generationId: 'run-a',
      messageId: 'follow-up-a',
      mode: 'follow-up' as const,
      text: 'Use blue',
      status: 'delivered' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const history = [
      event(1, { finalText: 'Current turn' }),
      event(2, { type: 'active_message', activeMessage }),
      event(3, { finalText: 'Current turn' }),
    ];
    project(history);
    expect(rows().map((row) => row.kind)).toEqual(['assistant_text', 'user', 'assistant_text']);
    expect(rows()[1]?.payload).toMatchObject({ text: 'Use blue', activeMessageId: 'follow-up-a' });
    expect(listSessionActiveMessages(opts, designId)).toEqual([activeMessage]);
    const before = await file();
    project(history);
    expect(await file()).toBe(before);
  });

  it('never regresses a delivered active receipt when replay includes its pending predecessor', async () => {
    const pending = {
      schemaVersion: 1 as const,
      designId,
      generationId: 'run-a',
      messageId: 'follow-up-a',
      mode: 'follow-up' as const,
      text: 'Use blue',
      status: 'pending' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const delivered = { ...pending, status: 'delivered' as const };
    const history = [
      event(1, { type: 'active_message', activeMessage: pending }),
      event(2, { type: 'active_message', activeMessage: delivered }),
    ];
    project(history);
    const before = await file();
    project([event(1, { type: 'active_message', activeMessage: pending })]);
    expect(listSessionActiveMessages(opts, designId)).toEqual([delivered]);
    project(history);
    expect(rows()).toHaveLength(1);
    expect(await file()).toBe(before);
  });
  it('repairs delivered authority after host recovery inferred that a message was not delivered', async () => {
    const pending = {
      schemaVersion: 1 as const,
      designId,
      generationId: 'run-a',
      messageId: 'follow-up-a',
      mode: 'follow-up' as const,
      text: 'Already consumed by the agent',
      status: 'pending' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const delivered = { ...pending, status: 'delivered' as const };
    const pendingEvent = event(1, { type: 'active_message', activeMessage: pending });
    const deliveredEvent = event(2, { type: 'active_message', activeMessage: delivered });
    project([pendingEvent]);
    // The delivered journal record exists, but its original projection failed.
    appendSessionActiveMessage(opts, {
      ...pending,
      status: 'not-delivered',
      reason: 'The previous run ended. Recover this message to send it again.',
    });
    expect(rows()).toEqual([]);
    project([deliveredEvent]);
    expect(listSessionActiveMessages(opts, designId)).toEqual([delivered]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.payload).toMatchObject({
      text: pending.text,
      activeMessageId: pending.messageId,
    });
    const before = await file();
    const reopened = initSnapshotsDb(path.join(root, 'design-store.json'));
    opts = { db: reopened, sessionDir: reopened.sessionDir };
    project([pendingEvent, deliveredEvent, deliveredEvent]);
    expect(listSessionActiveMessages(opts, designId)).toEqual([delivered]);
    expect(rows()).toHaveLength(1);
    expect(await file()).toBe(before);
  });
  it('persists pending active-message receipts without premature user chat', async () => {
    const activeMessage = {
      schemaVersion: 1 as const,
      designId,
      generationId: 'run-a',
      messageId: 'follow-up-a',
      mode: 'follow-up' as const,
      text: 'Use blue',
      status: 'pending' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pending = event(1, { type: 'active_message', activeMessage });
    project([pending]);
    expect(rows()).toEqual([]);
    expect(listSessionActiveMessages(opts, designId)).toEqual([activeMessage]);
    const before = await file();
    project([pending]);
    expect(await file()).toBe(before);
  });
});
