import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AskRequestPayload, AskStore } from './ask-store';

let directory: string;
let path: string;
const request = (requestId: string, designId = 'design-a'): AskRequestPayload => ({
  requestId,
  sessionId: `run-${requestId}`,
  runId: `run-${requestId}`,
  designId,
  input: { questions: [{ id: 'q1', type: 'freeform', prompt: 'Style?' }] },
});
const answer = { status: 'answered' as const, answers: [{ questionId: 'q1', value: 'minimal' }] };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ask-store-'));
  path = join(directory, 'ask-journal.jsonl');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('AskStore', () => {
  it('persists schema-versioned questions and answers and idempotent retries survive restart', async () => {
    const store = new AskStore(path);
    await store.create(request('one'));
    await store.settle('one', answer);
    const before = await readFile(path, 'utf8');
    const reopened = new AskStore(path);
    expect(await reopened.settle('one', answer)).toMatchObject({
      status: 'answered',
      result: answer,
    });
    expect(await readFile(path, 'utf8')).toBe(before);
    for (const line of before.trim().split('\n')) expect(JSON.parse(line).schemaVersion).toBe(1);
    await expect(
      reopened.settle('one', { status: 'cancelled', answers: [] }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
  });

  it('marks orphaned pending asks interrupted durably, retaining cancelled and answered history', async () => {
    const store = new AskStore(path);
    await store.create(request('orphan'));
    await store.create(request('answered'));
    await store.create(request('cancelled', 'design-b'));
    await store.settle('answered', answer);
    await store.settle('cancelled', { status: 'cancelled', answers: [] });
    const reopened = new AskStore(path);
    expect((await reopened.history()).map((entry) => entry.status)).toEqual([
      'interrupted',
      'answered',
      'cancelled',
    ]);
    expect(await reopened.history({ designId: 'design-b' })).toHaveLength(1);
    expect(await reopened.history({ runId: 'run-orphan' })).toEqual([
      expect.objectContaining({ status: 'interrupted' }),
    ]);
    await expect(reopened.settle('orphan', answer)).rejects.toThrow('interrupted');
    expect((await new AskStore(path).history())[0]?.status).toBe('interrupted');
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(6);
  });

  it('repairs only a torn final append before recording interruptions and new questions', async () => {
    await new AskStore(path).create(request('first'));
    await appendFile(path, '{"schemaVersion":1,"requestId":"torn');
    const reopened = new AskStore(path);
    await reopened.create(request('second'));
    expect((await reopened.history()).map((entry) => entry.status)).toEqual([
      'interrupted',
      'pending',
    ]);
    expect((await new AskStore(path).history()).map((entry) => entry.status)).toEqual([
      'interrupted',
      'interrupted',
    ]);
    for (const line of (await readFile(path, 'utf8')).trim().split('\n'))
      expect(() => JSON.parse(line)).not.toThrow();
  });

  it('does not commit a failed append in memory and permits retry after disk recovery', async () => {
    const store = new AskStore(path);
    await store.create(request('retry'));
    const backup = `${path}.backup`;
    await rename(path, backup);
    await mkdir(path);
    try {
      await expect(store.settle('retry', answer)).rejects.toThrow();
      expect(await store.history()).toEqual([expect.objectContaining({ status: 'pending' })]);
    } finally {
      await rm(path, { recursive: true });
      await rename(backup, path);
    }
    await store.settle('retry', answer);
    expect((await new AskStore(path).history())[0]).toMatchObject({
      status: 'answered',
      result: answer,
    });
  });
  it('refuses unsupported schemas and corruption in completed lines', async () => {
    await writeFile(path, '{"schemaVersion":2}\n');
    await expect(new AskStore(path).history()).rejects.toThrow('unsupported');
    await writeFile(path, 'not json\n');
    await expect(new AskStore(path).history()).rejects.toThrow();
  });

  it('normalizes answer order and multi-selection sets for idempotent concurrent retry', async () => {
    const store = new AskStore(path);
    await store.create({
      ...request('multi'),
      input: {
        questions: [
          { id: 'first', type: 'freeform', prompt: 'Why?' },
          {
            id: 'second',
            type: 'text-options',
            prompt: 'Which?',
            options: ['a', 'b'],
            multi: true,
          },
        ],
      },
    });
    await Promise.all([
      store.settle('multi', {
        status: 'answered',
        answers: [
          { questionId: 'second', value: ['b', 'a'] },
          { questionId: 'first', value: 'yes' },
        ],
      }),
      store.settle('multi', {
        status: 'answered',
        answers: [
          { questionId: 'first', value: 'yes' },
          { questionId: 'second', value: ['a', 'b'] },
        ],
      }),
    ]);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
  });
});
