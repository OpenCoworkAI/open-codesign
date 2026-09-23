import { appendFile, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentStreamEvent, GenerateResponse } from '../preload/index';
import { RunJournal } from './run-journal';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codesign-run-journal-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function event(
  runId = 'run-a',
  designId = 'design-a',
  extra: Partial<AgentStreamEvent> = {},
): AgentStreamEvent {
  return { type: 'text_delta', designId, generationId: runId, delta: 'hello', ...extra };
}

async function start(journal: RunJournal, runId = 'run-a', designId = 'design-a', startedAt = 1) {
  await journal.start({ runId, designId, startedAt });
}

async function lines(runId = 'run-a'): Promise<unknown[]> {
  return (await readFile(path.join(directory, `${runId}.jsonl`), 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}

describe('RunJournal', () => {
  it('persists a start header and numbered event before returning it', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const committed = await journal.append(event());

    expect(committed).toEqual({ ...event(), schemaVersion: 1, runId: 'run-a', seq: 1 });
    expect(await lines()).toEqual([
      { schemaVersion: 1, type: 'run_start', runId: 'run-a', designId: 'design-a', startedAt: 1 },
      committed,
    ]);
    expect(await readdir(directory)).toEqual(['run-a.jsonl']);
  });

  it('returns the same JSON payload that replay will read', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const committed = await journal.append(
      event('run-a', 'design-a', {
        result: { timestamp: new Date('2026-01-01T00:00:00.000Z') },
      }),
    );
    expect(committed.result).toEqual({ timestamp: '2026-01-01T00:00:00.000Z' });
    expect((await journal.recover({})).events).toEqual([committed]);
  });
  it('rejects duplicate starts instead of overwriting the run or its journal', async () => {
    const journal = new RunJournal(directory);
    const results = await Promise.allSettled([start(journal), start(journal)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const committed = await journal.append(event());
    await expect(start(new RunJournal(directory))).rejects.toThrow('already exists');
    expect((await lines())[1]).toEqual(committed);
  });

  it('serializes concurrent appends and snapshots mutable payloads before queueing', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const mutable = event('run-a', 'design-a', { args: { path: 'original.jsx' } });
    const first = journal.append(mutable);
    if (mutable.args) mutable.args['path'] = 'changed.jsx';
    const rest = Array.from({ length: 20 }, (_, index) =>
      journal.append(event('run-a', 'design-a', { delta: `${index}` })),
    );
    const events = await Promise.all([first, ...rest]);
    expect(events.map((item) => item.seq)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1),
    );
    expect(events[0]?.args).toEqual({ path: 'original.jsx' });
    expect((await lines()).slice(1)).toEqual(events);
  });

  it('keeps current-host runs active when recovering and applies cursors', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const first = await journal.append(event());
    const second = await journal.append(event('run-a', 'design-a', { delta: 'more' }));
    expect(await journal.recover({})).toEqual({ schemaVersion: 1, events: [first, second] });
    expect(await journal.recover({ 'run-a': 1 })).toEqual({ schemaVersion: 1, events: [second] });
    expect(await journal.recover({ 'run-a': 2 })).toEqual({ schemaVersion: 1, events: [] });
    expect((await lines()).length).toBe(3);
  });

  it('recovers the latest run per design plus explicitly cursor-mentioned older runs', async () => {
    const journal = new RunJournal(directory);
    await start(journal, 'old-a', 'design-a', 1);
    const old = await journal.append(event('old-a'));
    await start(journal, 'new-a', 'design-a', 2);
    const latest = await journal.append(event('new-a'));
    await start(journal, 'run-b', 'design-b', 3);
    const other = await journal.append(event('run-b', 'design-b'));

    expect((await journal.recover({})).events).toEqual([latest, other]);
    expect((await journal.recover({ 'old-a': 0 })).events).toEqual([old, latest, other]);
    expect((await journal.recover({ 'old-a': 1, unknown: 0 })).events).toEqual([latest, other]);
    expect(await journal.allEvents()).toEqual([old, latest, other]);
  });

  it('marks prior-host active runs interrupted once without restarting execution', async () => {
    const original = new RunJournal(directory);
    await start(original);
    const first = await original.append(event());
    const restarted = new RunJournal(directory);
    const recovered = await restarted.recover({});
    expect(recovered.events).toEqual([
      first,
      expect.objectContaining({
        schemaVersion: 1,
        type: 'run_settled',
        runId: 'run-a',
        generationId: 'run-a',
        designId: 'design-a',
        seq: 2,
        outcome: 'interrupted',
        message: expect.stringContaining('restarted'),
      }),
    ]);
    expect((await new RunJournal(directory).recover({})).events).toEqual(recovered.events);
    expect(await lines()).toHaveLength(3);
    await expect(restarted.append(event())).rejects.toThrow('terminal');
  });

  it('settles a prior-host run which only committed its start header', async () => {
    await start(new RunJournal(directory));
    expect((await new RunJournal(directory).recover({})).events).toEqual([
      expect.objectContaining({ type: 'run_settled', seq: 1, outcome: 'interrupted' }),
    ]);
  });

  it('preserves terminal responses and rejects events after settlement', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const response: GenerateResponse = {
      message: 'done',
      artifacts: [],
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0,
    };
    const terminal = await journal.append(
      event('run-a', 'design-a', { type: 'run_settled', outcome: 'completed', response }),
    );
    await expect(journal.append(event())).rejects.toThrow('terminal');
    expect((await new RunJournal(directory).recover({})).events).toEqual([terminal]);
    expect(await lines()).toHaveLength(2);
  });

  it('does not confuse agent_end with host settlement', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await journal.append(event('run-a', 'design-a', { type: 'agent_end' }));
    const final = await journal.append(
      event('run-a', 'design-a', { type: 'run_settled', outcome: 'completed' }),
    );
    expect(final.seq).toBe(2);
  });

  it('repairs only an uncommitted final line before appending interruption', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const committed = await journal.append(event());
    await appendFile(
      path.join(directory, 'run-a.jsonl'),
      '{"type":"text_delta","delta":"unfinished',
    );

    const recovered = await new RunJournal(directory).recover({});
    expect(recovered.events[0]).toEqual(committed);
    expect(recovered.events[1]).toMatchObject({ seq: 2, outcome: 'interrupted' });
    const text = await readFile(path.join(directory, 'run-a.jsonl'), 'utf8');
    expect(text).not.toContain('unfinished');
    expect(text.endsWith('\n')).toBe(true);
    expect(await lines()).toHaveLength(3);
  });

  it('treats a complete JSON object without its newline as uncommitted', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await appendFile(
      path.join(directory, 'run-a.jsonl'),
      JSON.stringify({ ...event(), schemaVersion: 1, runId: 'run-a', seq: 1 }),
    );
    const recovered = await new RunJournal(directory).recover({});
    expect(recovered.events).toEqual([
      expect.objectContaining({ type: 'run_settled', outcome: 'interrupted', seq: 1 }),
    ]);
  });

  it('fails closed on committed JSON corruption without erasing later valid records', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await journal.append(event());
    await appendFile(
      path.join(directory, 'run-a.jsonl'),
      'broken committed JSON\n{"valid":"later"}\n',
    );
    const before = await readFile(path.join(directory, 'run-a.jsonl'), 'utf8');
    const restarted = new RunJournal(directory);
    await expect(restarted.recover({})).rejects.toThrow();
    await expect(restarted.allEvents()).rejects.toThrow();
    expect(await readFile(path.join(directory, 'run-a.jsonl'), 'utf8')).toBe(before);
  });

  it.each([
    { seq: 3 },
    { schemaVersion: 2 },
    { runId: 'different' },
    { generationId: 'different' },
    { designId: 'different' },
    { type: 'unknown' },
    { type: 'run_settled', outcome: 'not-terminal' },
  ])('rejects a committed invalid envelope %j', async (override) => {
    const journal = new RunJournal(directory);
    await start(journal);
    const bad = { ...event(), schemaVersion: 1, runId: 'run-a', seq: 1, ...override };
    await appendFile(path.join(directory, 'run-a.jsonl'), `${JSON.stringify(bad)}\n`);
    await expect(new RunJournal(directory).recover({})).rejects.toThrow('Run journal');
  });

  it('rejects a journal without a committed start header', async () => {
    await writeFile(path.join(directory, 'run-a.jsonl'), '{"type":"run_start"');
    await expect(new RunJournal(directory).recover({})).rejects.toThrow('start');
    expect(await readFile(path.join(directory, 'run-a.jsonl'), 'utf8')).toBe('{"type":"run_start"');
  });

  it('reads UTF-8 records spanning stream chunk boundaries', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    const delta = '设计🙂'.repeat(20_000);
    await journal.append(event('run-a', 'design-a', { delta }));
    expect((await journal.recover({})).events[0]?.delta).toBe(delta);
  });

  it.each([
    '../escape',
    'a/b',
    'a\\b',
    'C:drive',
    '',
    '.',
    '..',
    'con',
    'NUL',
    'lpt1',
    'x'.repeat(129),
  ])('rejects unsafe identifier %j', async (runId) => {
    const journal = new RunJournal(directory);
    await expect(start(journal, runId)).rejects.toThrow('identifier');
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
  ])('rejects invalid startedAt %s', async (time) => {
    await expect(start(new RunJournal(directory), 'run-a', 'design-a', time)).rejects.toThrow(
      'startedAt',
    );
  });

  it('rejects bad append identities and unknown runs without consuming a sequence', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await expect(journal.append(event('unknown'))).rejects.toThrow('unknown run');
    await expect(journal.append(event('run-a', 'wrong-design'))).rejects.toThrow('envelope');
    await expect(journal.append(event('run-a', 'design-a', { runId: 'other' }))).rejects.toThrow(
      'runId',
    );
    expect((await journal.append(event())).seq).toBe(1);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
  ])('rejects invalid cursor %s', async (cursor) => {
    await expect(new RunJournal(directory).recover({ 'run-a': cursor })).rejects.toThrow('cursor');
  });

  it('rejects invalid cursor container and path-like cursor keys', async () => {
    const journal = new RunJournal(directory);
    await expect(journal.recover(null as unknown as Record<string, number>)).rejects.toThrow(
      'object',
    );
    await expect(journal.recover([] as unknown as Record<string, number>)).rejects.toThrow(
      'object',
    );
    await expect(journal.recover({ '../escape': 0 })).rejects.toThrow('identifier');
  });

  it('rejects missing-file writes and never silently recreates a journal', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await unlink(path.join(directory, 'run-a.jsonl'));
    await expect(journal.append(event())).rejects.toThrow();
    await expect(journal.append(event())).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });

  it('fails closed on foreign bytes until a new host repairs the uncommitted tail', async () => {
    const journal = new RunJournal(directory);
    await start(journal);
    await appendFile(path.join(directory, 'run-a.jsonl'), 'partial');
    await expect(journal.append(event())).rejects.toThrow('size changed');
    await expect(journal.append(event())).rejects.toThrow('size changed');
    expect((await new RunJournal(directory).recover({})).events).toEqual([
      expect.objectContaining({ type: 'run_settled', seq: 1, outcome: 'interrupted' }),
    ]);
  });
});
