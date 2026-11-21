import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { SessionManager } from '@open-codesign/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../preload/index';
import { projectRunEventHistory, projectRunEventToChat } from './run-event-chat';
import { RunEventDelivery } from './run-event-delivery';
import {
  appendSessionActiveMessage,
  appendSessionChatMessage,
  CHAT_MESSAGE_CUSTOM_TYPE,
  listSessionChatMessages,
  type SessionChatStoreOptions,
  sessionChatProjection,
} from './session-chat';
import { createDesign, initSnapshotsDb, updateDesignWorkspace } from './snapshots-db';

let root: string;
let designId: string;
let opts: SessionChatStoreOptions;
let file: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codesign-chat-streaming-'));
  const db = initSnapshotsDb(path.join(root, 'design-store.json'));
  const design = createDesign(db, 'Streaming history');
  designId = design.id;
  updateDesignWorkspace(db, designId, root);
  opts = { db, sessionDir: db.sessionDir };
  file = path.join(db.sessionDir, `${designId}.jsonl`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function stored(seq: number, text: string) {
  return {
    schemaVersion: 1,
    id: seq,
    seq,
    kind: 'assistant_text',
    payload: {
      text,
      runId: 'old-run',
      runEventKey: `old-run:${seq}`,
    },
    snapshotId: null,
  };
}
function seed(count: number, destination = file): void {
  const manager = SessionManager.inMemory(root);
  for (let seq = 0; seq < count; seq++)
    manager.appendCustomEntry(CHAT_MESSAGE_CUSTOM_TYPE, stored(seq, `history-${seq}`));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    `${[manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  );
}
function event(seq: number, extra: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
  return {
    schemaVersion: 1,
    designId,
    generationId: 'new-run',
    runId: 'new-run',
    seq,
    type: 'turn_end',
    finalText: `reply-${seq}`,
    ...extra,
  };
}
function reopened() {
  const db = initSnapshotsDb(opts.db.storePath);
  return { db, sessionDir: db.sessionDir };
}

describe('incremental pi session projection', () => {
  it('loads a large history once while indexing live tools, results and replay keys', () => {
    seed(4000);
    const open = vi.spyOn(SessionManager, 'open');
    const entries = vi.spyOn(SessionManager.prototype, 'getEntries');
    const before = readFileSync(file, 'utf8');
    const history = Array.from({ length: 120 }, (_, index) =>
      event(
        index + 1,
        index % 2 === 0
          ? {
              type: 'tool_call_start',
              toolName: 'read',
              toolCallId: `tool-${Math.floor(index / 2)}`,
            }
          : {
              type: 'tool_call_result',
              toolCallId: `tool-${Math.floor(index / 2)}`,
              status: 'done',
              result: 'ok',
            },
      ),
    );
    for (const item of history) projectRunEventToChat(opts, item);
    for (const item of history) projectRunEventToChat(opts, item);
    expect(open).toHaveBeenCalledTimes(1);
    expect(entries).toHaveBeenCalledTimes(1);
    const after = readFileSync(file, 'utf8');
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length).trim().split('\n')).toHaveLength(120);
    const rows = listSessionChatMessages(opts, designId);
    expect(rows).toHaveLength(4060);
    expect(rows.at(-1)?.payload).toMatchObject({ status: 'done', result: 'ok' });
    expect(listSessionChatMessages(reopened(), designId)).toEqual(rows);
  });

  it('writes a new session header once, then appends pi records without reopening each time', () => {
    const open = vi.spyOn(SessionManager, 'open');
    for (let seq = 1; seq <= 30; seq++) projectRunEventToChat(opts, event(seq));
    expect(open).toHaveBeenCalledTimes(2);
    const manager = SessionManager.open(file, opts.sessionDir, root);
    expect(manager.getHeader()).not.toBeNull();
    const entries = manager.getEntries();
    expect(entries).toHaveLength(30);
    expect(manager.getBranch().map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
  });

  it('refreshes external pi appends and keeps parent links and row sequences intact', () => {
    projectRunEventToChat(opts, event(1));
    const external = SessionManager.open(file, opts.sessionDir, root);
    const externalId = external.appendCustomEntry(CHAT_MESSAGE_CUSTOM_TYPE, stored(1, 'external'));
    const prefix = readFileSync(file, 'utf8');
    projectRunEventToChat(opts, event(2));
    expect(readFileSync(file, 'utf8').startsWith(prefix)).toBe(true);
    const rows = listSessionChatMessages(opts, designId);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]);
    expect(rows[1]?.payload).toMatchObject({ text: 'external' });
    const latest = SessionManager.open(file, opts.sessionDir, root).getEntries().at(-1);
    expect(latest?.parentId).toBe(externalId);
  });

  it.each([
    'partial',
    'complete',
  ] as const)('preserves a %s final JSONL line while making the next append readable', (tail) => {
    projectRunEventToChat(opts, event(1));
    const old = readFileSync(file, 'utf8');
    const prefix = tail === 'partial' ? `${old}{"type":"custom","data":` : old.trimEnd();
    writeFileSync(file, prefix);
    projectRunEventToChat(opts, event(2));
    expect(readFileSync(file, 'utf8').startsWith(`${prefix}\n`)).toBe(true);
    expect(listSessionChatMessages(reopened(), designId).map((row) => row.seq)).toEqual([0, 1]);
    expect(SessionManager.open(file, opts.sessionDir, root).getBranch()).toHaveLength(2);
  });

  it('rebuilds stale event indexes after external replacement and valid-header truncation', () => {
    projectRunEventToChat(opts, event(1));
    const replacement = `${file}.replacement`;
    seed(2, replacement);
    unlinkSync(file);
    renameSync(replacement, file);
    projectRunEventToChat(opts, event(1));
    expect(listSessionChatMessages(opts, designId)).toHaveLength(3);
    const header = readFileSync(file, 'utf8').split('\n')[0];
    writeFileSync(file, `${header}\n`);
    projectRunEventToChat(opts, event(1));
    expect(listSessionChatMessages(opts, designId)).toHaveLength(1);
    expect(readFileSync(file, 'utf8').split('\n')[0]).toBe(header);
  });

  it('keeps headerless corruption unchanged instead of letting pi reset the file', () => {
    projectRunEventToChat(opts, event(1));
    writeFileSync(file, 'interrupted-header');
    expect(() => listSessionChatMessages(opts, designId)).toThrow('Session header is damaged');
    expect(() => projectRunEventToChat(opts, event(2))).toThrow('Session header is damaged');
    expect(readFileSync(file, 'utf8')).toBe('interrupted-header');
  });

  it('rejects an existing zero-byte file without acknowledging or rewriting a message', () => {
    mkdirSync(opts.sessionDir, { recursive: true });
    writeFileSync(file, '');
    expect(() => projectRunEventToChat(opts, event(1))).toThrow('Session header is damaged');
    expect(() => listSessionChatMessages(opts, designId)).toThrow('Session header is damaged');
    expect(statSync(file).size).toBe(0);
  });

  it('drops cached history when its file is deleted and starts a fresh durable log on append', () => {
    projectRunEventToChat(opts, event(1));
    unlinkSync(file);
    expect(listSessionChatMessages(opts, designId)).toEqual([]);
    projectRunEventToChat(opts, event(1));
    expect(listSessionChatMessages(reopened(), designId)).toHaveLength(1);
  });

  it('rejects malformed stored chat data without overwriting other session records', () => {
    projectRunEventToChat(opts, event(1));
    const external = SessionManager.open(file, opts.sessionDir, root);
    external.appendCustomEntry(CHAT_MESSAGE_CUSTOM_TYPE, { schemaVersion: 1, broken: true });
    const original = readFileSync(file, 'utf8');
    expect(() => projectRunEventToChat(opts, event(2))).toThrow('Malformed stored chat message');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it.each([
    'damaged-version',
    0,
    999,
    1.5,
  ])('rejects invalid header version %s before pi can rewrite damaged bytes', (version) => {
    seed(1);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const header = JSON.parse(lines[0] ?? '{}');
    lines[0] = JSON.stringify({ ...header, version });
    const original = `${lines.join('\n')}\n{"partial":`;
    writeFileSync(file, original);
    expect(() => listSessionChatMessages(opts, designId)).toThrow('Session header is damaged');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('migrates a clean legacy session through pi while retaining existing history', () => {
    seed(2);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const header = JSON.parse(lines[0] ?? '{}');
    lines[0] = JSON.stringify({ ...header, version: 2 });
    writeFileSync(file, `${lines.join('\n')}\n`);
    projectRunEventToChat(opts, event(1));
    expect(listSessionChatMessages(opts, designId)).toHaveLength(3);
    expect(SessionManager.open(file, opts.sessionDir, root).getHeader()?.version).toBe(
      CURRENT_SESSION_VERSION,
    );
  });

  it.each([
    '{"partial":',
    'broken\n',
    'null\n',
    'false\n',
    '0\n',
    '""\n',
    '[]\n',
  ])('preserves damaged legacy records %s before pi migration', (damage) => {
    seed(1);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const header = JSON.parse(lines[0] ?? '{}');
    lines[0] = JSON.stringify({ ...header, version: 2 });
    const original = `${lines.join('\n')}\n${damage}`;
    writeFileSync(file, original);
    expect(() => listSessionChatMessages(opts, designId)).toThrow('damaged records');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('validates malformed legacy chat data in memory before allowing pi migration to write', () => {
    seed(1);
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const header = JSON.parse(lines[0] ?? '{}');
    const row = JSON.parse(lines[1] ?? '{}');
    lines[0] = JSON.stringify({ ...header, version: 2 });
    lines[1] = JSON.stringify({ ...row, data: { broken: true } });
    const original = `${lines.join('\n')}\n`;
    writeFileSync(file, original);
    expect(() => listSessionChatMessages(opts, designId)).toThrow('Malformed stored chat message');
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('does not let caller mutations poison deduplication or cached history', () => {
    const input = { text: 'original', runId: 'new-run', runEventKey: 'new-run:1' };
    const row = appendSessionChatMessage(opts, {
      designId,
      kind: 'assistant_text',
      payload: input,
    });
    input.text = 'mutated';
    (row.payload as { runEventKey: string }).runEventKey = 'changed';
    const listed = listSessionChatMessages(opts, designId);
    (listed[0]?.payload as { text: string }).text = 'also mutated';
    projectRunEventToChat(opts, event(1));
    expect(listSessionChatMessages(opts, designId)).toHaveLength(1);
    expect(listSessionChatMessages(opts, designId)[0]?.payload).toMatchObject({
      text: 'original',
      runEventKey: 'new-run:1',
    });
  });

  it('clones bounded projection query results so callers cannot mutate cached tools or receipts', () => {
    projectRunEventToChat(
      opts,
      event(1, { type: 'tool_call_start', toolCallId: 'tool-a', toolName: 'read' }),
    );
    appendSessionActiveMessage(opts, {
      schemaVersion: 1,
      designId,
      generationId: 'new-run',
      messageId: 'active-a',
      mode: 'follow-up',
      text: 'follow up',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const projection = sessionChatProjection(opts, designId);
    const tool = projection.tool('new-run', 'tool-a');
    (tool?.payload as Record<string, unknown>)['status'] = 'poisoned';
    const running = projection.runningTools('new-run');
    (running[0]?.payload as Record<string, unknown>)['runResultEventKey'] = 'new-run:9999';
    const active = projection.activeMessage('active-a');
    if (active) active.text = 'poisoned';
    projectRunEventToChat(
      opts,
      event(2, { type: 'tool_call_result', toolCallId: 'tool-a', status: 'done' }),
    );
    expect(listSessionChatMessages(opts, designId)[0]?.payload).toMatchObject({
      status: 'done',
      runResultEventKey: 'new-run:2',
    });
    expect(projection.activeMessage('active-a')?.text).toBe('follow up');
  });

  it('recovers an evicted conversation without losing its pi history', () => {
    projectRunEventToChat(opts, event(1));
    for (let index = 0; index < 9; index++) {
      const design = createDesign(opts.db, `Other ${index}`);
      updateDesignWorkspace(opts.db, design.id, root);
      appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'user',
        payload: { text: 'hello' },
      });
    }
    projectRunEventToChat(opts, event(2));
    expect(listSessionChatMessages(opts, designId)).toHaveLength(2);
    expect(SessionManager.open(file, opts.sessionDir, root).getBranch()).toHaveLength(2);
  });

  it('yields while repairing a journal and still projects every event exactly once', async () => {
    let rowsWhenServiced = -1;
    const observation = new Promise<void>((resolve) =>
      setImmediate(() => {
        rowsWhenServiced = listSessionChatMessages(opts, designId).length;
        resolve();
      }),
    );
    await projectRunEventHistory(
      opts,
      Array.from({ length: 100 }, (_, index) => event(index + 1)),
    );
    await observation;
    expect(rowsWhenServiced).toBeGreaterThanOrEqual(0);
    expect(rowsWhenServiced).toBeLessThan(100);
    expect(listSessionChatMessages(opts, designId)).toHaveLength(100);
    const before = statSync(file).size;
    await projectRunEventHistory(
      opts,
      Array.from({ length: 100 }, (_, index) => event(index + 1)),
    );
    expect(statSync(file).size).toBe(before);
  });

  it('serializes a concurrently published live event behind yielding history repair', async () => {
    const delivery = new RunEventDelivery();
    const history = Array.from({ length: 64 }, (_, index) => event(index + 1));
    const repair = delivery.enqueue(() => projectRunEventHistory(opts, history));
    const live = delivery.enqueue(async () =>
      projectRunEventToChat(
        opts,
        event(1, {
          generationId: 'live-run',
          runId: 'live-run',
          finalText: 'newer-live',
        }),
      ),
    );
    await Promise.all([repair, live, delivery.settled()]);
    expect(
      listSessionChatMessages(opts, designId).map((row) => (row.payload as { text: string }).text),
    ).toEqual([...history.map((row) => row.finalText), 'newer-live']);
  });

  it('does not let a failed repair poison subsequent live publication', async () => {
    const delivery = new RunEventDelivery();
    const repair = delivery.enqueue(async () => {
      throw new Error('repair failed');
    });
    const live = delivery.enqueue(async () => projectRunEventToChat(opts, event(1)));
    await expect(repair).rejects.toThrow('repair failed');
    await live;
    expect(listSessionChatMessages(opts, designId)).toHaveLength(1);
  });
});
