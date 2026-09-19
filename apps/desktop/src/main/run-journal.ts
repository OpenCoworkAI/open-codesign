import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentStreamEvent } from '../preload/index';

export interface RunJournalStart {
  runId: string;
  designId: string;
  startedAt: number;
}

export interface RunJournalRecovery {
  schemaVersion: 1;
  events: AgentStreamEvent[];
}

type JournalEvent = AgentStreamEvent & { schemaVersion: 1; runId: string; seq: number };

interface RunState extends RunJournalStart {
  seq: number;
  bytes: number;
  settled: boolean;
  writeError?: Error;
}

const EVENT_TYPES = new Set<AgentStreamEvent['type']>([
  'turn_start',
  'text_delta',
  'turn_end',
  'tool_call_start',
  'tool_call_result',
  'fs_updated',
  'agent_end',
  'active_message',
  'run_settled',
  'error',
]);
const OUTCOMES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const WINDOWS_RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function invalid(message: string): Error {
  return new Error(`Run journal: ${message}`);
}

function assertId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value) ||
    WINDOWS_RESERVED_ID.test(value)
  ) {
    throw invalid('invalid run or design identifier');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('expected an object record');
  }
  return value as Record<string, unknown>;
}

function validateStart(input: RunJournalStart): void {
  assertId(input.runId);
  assertId(input.designId);
  if (!Number.isSafeInteger(input.startedAt) || input.startedAt < 0) {
    throw invalid('startedAt must be a non-negative safe integer');
  }
}

function validateEvent(value: unknown, run: RunState, seq: number): JournalEvent {
  const record = object(value);
  if (
    record['schemaVersion'] !== 1 ||
    record['runId'] !== run.runId ||
    record['generationId'] !== run.runId ||
    record['designId'] !== run.designId ||
    record['seq'] !== seq ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    !EVENT_TYPES.has(record['type'] as AgentStreamEvent['type'])
  ) {
    throw invalid(`invalid event envelope for ${run.runId}`);
  }
  if (run.settled) throw invalid(`event after terminal state for ${run.runId}`);
  if (record['type'] === 'run_settled' && !OUTCOMES.has(record['outcome'] as string)) {
    throw invalid(`invalid terminal outcome for ${run.runId}`);
  }
  return record as unknown as JournalEvent;
}

function encode(value: unknown): Buffer {
  const data = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (data.length > MAX_RECORD_BYTES) throw invalid('record exceeds the 64 MiB size limit');
  return data;
}

/** One instance owns one host's journal directory; consumers only see committed events. */
export class RunJournal {
  private readonly directory: string;
  private readonly runs = new Map<string, RunState>();
  private initialization: Promise<void> | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  start(input: RunJournalStart): Promise<void> {
    const start = { runId: input.runId, designId: input.designId, startedAt: input.startedAt };
    return this.serialize(async () => {
      validateStart(start);
      await this.initialize();
      if (this.runs.has(start.runId)) throw invalid(`run already exists: ${start.runId}`);
      const bytes = encode({ schemaVersion: 1, type: 'run_start', ...start });
      const handle = await open(this.filePath(start.runId), 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.runs.set(start.runId, { ...start, seq: 0, bytes: bytes.length, settled: false });
    });
  }

  append(event: AgentStreamEvent): Promise<AgentStreamEvent> {
    // Snapshot before queueing: callers may reuse mutable tool arguments on the next event.
    let snapshot: AgentStreamEvent;
    try {
      snapshot = structuredClone(event);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.serialize(async () => {
      assertId(snapshot.generationId);
      assertId(snapshot.designId);
      await this.initialize();
      const run = this.runs.get(snapshot.generationId);
      if (!run) throw invalid(`unknown run: ${snapshot.generationId}`);
      if (snapshot.runId !== undefined && snapshot.runId !== run.runId) {
        throw invalid('runId must equal generationId');
      }
      return this.appendToRun(run, snapshot);
    });
  }

  recover(cursors: Record<string, number>): Promise<RunJournalRecovery> {
    const snapshot = { ...cursors };
    return this.serialize(async () => {
      object(cursors);
      for (const [runId, cursor] of Object.entries(snapshot)) {
        assertId(runId);
        if (!Number.isSafeInteger(cursor) || cursor < 0) {
          throw invalid('cursor must be a non-negative safe integer');
        }
      }
      await this.initialize();
      const latest = new Map<string, RunState>();
      for (const run of this.sortedRuns()) latest.set(run.designId, run);
      const selected = new Set([...latest.values()].map((run) => run.runId));
      for (const runId of Object.keys(snapshot)) {
        if (this.runs.has(runId)) selected.add(runId);
      }
      const events: AgentStreamEvent[] = [];
      for (const run of this.sortedRuns()) {
        if (!selected.has(run.runId)) continue;
        const after = Object.hasOwn(snapshot, run.runId) ? snapshot[run.runId] : 0;
        const loaded = await this.readRun(run.runId, events, after ?? 0);
        this.assertUnchanged(run, loaded);
      }
      return { schemaVersion: 1, events };
    });
  }

  /** Startup projection repair; history is streamed from disk and never retained by this instance. */
  allEvents(): Promise<AgentStreamEvent[]> {
    return this.serialize(async () => {
      await this.initialize();
      const events: AgentStreamEvent[] = [];
      for (const run of this.sortedRuns()) {
        const loaded = await this.readRun(run.runId, events);
        this.assertUnchanged(run, loaded);
      }
      return events;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.loadRuns();
    return this.initialization;
  }

  private async loadRuns(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const root = await lstat(this.directory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw invalid('unsafe journal directory');
    const entries = await readdir(this.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith('.jsonl')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw invalid('unsafe journal file');
      const runId = entry.name.slice(0, -'.jsonl'.length);
      assertId(runId);
      const run = await this.readRun(runId, undefined, 0, true);
      this.runs.set(runId, run);
    }
    // A new host cannot resurrect provider calls, JavaScript promises or tool side effects.
    for (const run of this.sortedRuns()) {
      if (run.settled) continue;
      await this.appendToRun(run, {
        type: 'run_settled',
        designId: run.designId,
        generationId: run.runId,
        outcome: 'interrupted',
        message: 'Run interrupted because the application restarted.',
      });
    }
  }

  private filePath(runId: string): string {
    assertId(runId);
    return path.join(this.directory, `${runId}.jsonl`);
  }

  private sortedRuns(): RunState[] {
    return [...this.runs.values()].sort(
      (left, right) =>
        left.startedAt - right.startedAt || left.runId.localeCompare(right.runId, 'en'),
    );
  }

  private assertUnchanged(expected: RunState, actual: RunState): void {
    if (
      expected.writeError ||
      expected.seq !== actual.seq ||
      expected.bytes !== actual.bytes ||
      expected.designId !== actual.designId ||
      expected.startedAt !== actual.startedAt
    ) {
      throw expected.writeError ?? invalid(`journal changed outside its owner: ${expected.runId}`);
    }
  }

  private async appendToRun(run: RunState, input: AgentStreamEvent): Promise<JournalEvent> {
    if (run.writeError) throw run.writeError;
    const event = validateEvent(
      { ...input, schemaVersion: 1, runId: run.runId, seq: run.seq + 1 },
      run,
      run.seq + 1,
    );
    const bytes = encode(event);
    const committed = JSON.parse(bytes.toString('utf8')) as JournalEvent;
    try {
      const info = await lstat(this.filePath(run.runId));
      if (!info.isFile() || info.isSymbolicLink()) throw invalid('unsafe journal file');
      // Do not recreate deleted files or append after unacknowledged/foreign bytes.
      const handle = await open(this.filePath(run.runId), constants.O_WRONLY | constants.O_APPEND);
      try {
        if ((await handle.stat()).size !== run.bytes) throw invalid('journal size changed');
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      run.writeError = error instanceof Error ? error : invalid('journal write failed');
      throw run.writeError;
    }
    run.seq = event.seq;
    run.bytes += bytes.length;
    run.settled = event.type === 'run_settled';
    return committed;
  }

  private async readRun(
    runId: string,
    events?: AgentStreamEvent[],
    after = 0,
    repairTail = false,
  ): Promise<RunState> {
    const filename = this.filePath(runId);
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw invalid('unsafe journal file');
    const handle = await open(filename, repairTail ? 'r+' : 'r');
    let run: RunState | undefined;
    let remaining: Buffer = Buffer.alloc(0);
    const decode = new TextDecoder('utf-8', { fatal: true });
    try {
      const stream = handle.createReadStream({ autoClose: false });
      for await (const chunk of stream) {
        remaining = Buffer.concat([remaining, chunk as Buffer]);
        let newline = remaining.indexOf(10);
        while (newline !== -1) {
          if (newline + 1 > MAX_RECORD_BYTES) throw invalid('record exceeds the 64 MiB size limit');
          const record: unknown = JSON.parse(decode.decode(remaining.subarray(0, newline)));
          if (!run) {
            const header = object(record);
            if (header['schemaVersion'] !== 1 || header['type'] !== 'run_start') {
              throw invalid(`invalid start record for ${runId}`);
            }
            const start = {
              runId: header['runId'] as string,
              designId: header['designId'] as string,
              startedAt: header['startedAt'] as number,
            };
            validateStart(start);
            if (start.runId !== runId) throw invalid('run identifier differs from filename');
            run = { ...start, seq: 0, bytes: 0, settled: false };
          } else {
            const event = validateEvent(record, run, run.seq + 1);
            run.seq = event.seq;
            run.settled = event.type === 'run_settled';
            if (events && event.seq > after) events.push(event);
          }
          run.bytes += newline + 1;
          remaining = remaining.subarray(newline + 1);
          newline = remaining.indexOf(10);
        }
        if (remaining.length > MAX_RECORD_BYTES)
          throw invalid('record exceeds the 64 MiB size limit');
      }
      if (!run) throw invalid(`missing committed start record for ${runId}`);
      if (remaining.length > 0) {
        if (!repairTail) throw invalid(`uncommitted tail for active journal ${runId}`);
        await handle.truncate(run.bytes);
        await handle.sync();
      }
      return run;
    } finally {
      await handle.close();
    }
  }
}
