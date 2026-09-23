import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const failures = vi.hoisted(() => ({
  append: undefined as 'partial' | 'flush' | undefined,
  rollback: undefined as 'truncate' | 'sync' | undefined,
  appends: 0,
  rollbackSyncs: 0,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    appendFile: async (...args: Parameters<typeof fs.appendFile>) => {
      failures.appends++;
      const failure = failures.append;
      failures.append = undefined;
      if (!failure) return fs.appendFile(...args);
      const [path, data, options] = args;
      if (typeof data !== 'string') throw new Error('Expected UTF-8 journal append');
      await fs.appendFile(
        path,
        failure === 'partial' ? data.slice(0, Math.floor(data.length / 2)) : data,
        options,
      );
      throw new Error(
        failure === 'partial'
          ? 'Injected partial write failure'
          : 'Injected fsync failure after complete write',
      );
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const truncate = handle.truncate.bind(handle);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, 'truncate').mockImplementation(async (length) => {
        if (failures.rollback === 'truncate') {
          failures.rollback = undefined;
          throw new Error('Injected rollback truncate failure');
        }
        return truncate(length);
      });
      vi.spyOn(handle, 'sync').mockImplementation(async () => {
        failures.rollbackSyncs++;
        if (failures.rollback === 'sync') {
          failures.rollback = undefined;
          throw new Error('Injected rollback sync failure');
        }
        return sync();
      });
      return handle;
    },
  };
});

import { AskStore } from './ask-store';

let directory: string;
let path: string;
const request = {
  requestId: 'question',
  sessionId: 'run',
  designId: 'design',
  input: { questions: [{ id: 'style', type: 'freeform' as const, prompt: 'Style? 风格？' }] },
};
const answer = {
  status: 'answered' as const,
  answers: [{ questionId: 'style', value: 'Quiet 宁静' }],
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ask-append-failure-'));
  path = join(directory, 'questions.jsonl');
  failures.append = undefined;
  failures.rollback = undefined;
  failures.appends = 0;
  failures.rollbackSyncs = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('ask journal append failure recovery', () => {
  it.each([
    'partial',
    'flush',
  ] as const)('rolls back %s write failure to the acknowledged byte length before accepting a different retry', async (failure) => {
    const store = new AskStore(path);
    await store.create(request);
    const acknowledged = await readFile(path, 'utf8');
    failures.append = failure;
    await expect(store.settle('question', answer)).rejects.toThrow('Injected');
    expect(await readFile(path, 'utf8')).toBe(acknowledged);
    expect(failures.rollbackSyncs).toBe(1);
    expect(await store.history()).toEqual([expect.objectContaining({ status: 'pending' })]);
    const corrected = {
      status: 'answered' as const,
      answers: [{ questionId: 'style', value: 'Warm 温暖' }],
    };
    await store.settle('question', corrected);
    await store.settle('question', corrected);
    expect((await new AskStore(path).history())[0]).toMatchObject({
      status: 'answered',
      result: corrected,
    });
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line).status)).toEqual(['pending', 'answered']);
  });

  it('rolls back a partially written first request to an empty journal and permits retry', async () => {
    const store = new AskStore(path);
    failures.append = 'partial';
    await expect(store.create(request)).rejects.toThrow('Injected partial write failure');
    expect(await readFile(path, 'utf8')).toBe('');
    expect(await store.history()).toEqual([]);
    await store.create(request);
    expect((await store.history())[0]?.status).toBe('pending');
    expect((await new AskStore(path).history())[0]?.status).toBe('interrupted');
  });

  it.each([
    'truncate',
    'sync',
  ] as const)('poisons mutations when rollback %s fails while retaining readable pending history', async (rollback) => {
    const store = new AskStore(path);
    await store.create(request);
    failures.append = 'partial';
    failures.rollback = rollback;
    await expect(store.settle('question', answer)).rejects.toThrow('restart the app');
    const appends = failures.appends;
    await expect(store.settle('question', answer)).rejects.toThrow('restart the app');
    await expect(store.create({ ...request, requestId: 'another' })).rejects.toThrow(
      'restart the app',
    );
    expect(failures.appends).toBe(appends);
    expect(await store.history()).toEqual([expect.objectContaining({ status: 'pending' })]);
    // A new host may repair the torn tail, but never resurrects the abandoned resolver.
    const reopened = new AskStore(path);
    expect((await reopened.history())[0]?.status).toBe('interrupted');
    await reopened.create({ ...request, requestId: 'new-host' });
    expect((await reopened.history())[1]?.status).toBe('pending');
  });

  it('does not reload through a poisoned interruption append in the same host', async () => {
    await new AskStore(path).create(request);
    const reopened = new AskStore(path);
    failures.append = 'partial';
    failures.rollback = 'truncate';
    await expect(reopened.history()).rejects.toThrow('restart the app');
    const appends = failures.appends;
    await expect(reopened.history()).rejects.toThrow('restart the app');
    expect(failures.appends).toBe(appends);
    expect((await new AskStore(path).history())[0]?.status).toBe('interrupted');
  });
});
