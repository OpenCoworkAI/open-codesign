import { describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent, RunRecoveryResult } from '../../../preload/index';
import { attachRunEvents } from './run-event-attachment';

function event(seq: number, type: AgentStreamEvent['type'] = 'text_delta'): AgentStreamEvent {
  return {
    schemaVersion: 1,
    runId: 'run',
    generationId: 'run',
    designId: 'design',
    seq,
    type,
    delta: `${seq}`,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(recover: (cursors: Record<string, number>) => Promise<RunRecoveryResult>) {
  let listener!: (event: AgentStreamEvent) => void;
  const off = vi.fn();
  const consume = vi.fn();
  const onError = vi.fn();
  const attachment = attachRunEvents({
    subscribe: (cb) => {
      listener = cb;
      return off;
    },
    recover,
    consume,
    onError,
  });
  return { listener, off, consume, onError, attachment };
}

describe('run event reattachment', () => {
  it('subscribes before replay and deduplicates overlap, preserving partial text', async () => {
    const response = deferred<RunRecoveryResult>();
    const recover = vi.fn(() => response.promise);
    const f = fixture(recover);
    f.listener(event(2));
    f.listener(event(3));
    response.resolve({ schemaVersion: 1, events: [event(1, 'turn_start'), event(2)] });
    await f.attachment.recover();
    expect(f.consume.mock.calls.map(([value]) => value.seq)).toEqual([1, 2, 3]);
    f.listener(event(2));
    f.listener(event(4));
    expect(f.consume.mock.calls.map(([value]) => value.seq)).toEqual([1, 2, 3, 4]);
    f.attachment.dispose();
    expect(f.off).toHaveBeenCalledOnce();
  });

  it('repairs a sequence gap before consuming later live events', async () => {
    const recover = vi.fn(async () => ({
      schemaVersion: 1 as const,
      events: [event(1, 'turn_start')],
    }));
    const f = fixture(recover);
    await f.attachment.recover();
    recover.mockResolvedValueOnce({ schemaVersion: 1, events: [event(2), event(3)] });
    f.listener(event(4));
    await f.attachment.recover();
    expect(recover).toHaveBeenLastCalledWith({ run: 1 });
    expect(f.consume.mock.calls.map(([value]) => value.seq)).toEqual([1, 2, 3, 4]);
    f.attachment.dispose();
  });

  it('recovers a missed terminal event once without advancing the cursor twice', async () => {
    const terminal = { ...event(2, 'run_settled'), outcome: 'completed' as const };
    const recover = vi.fn(async () => ({
      schemaVersion: 1 as const,
      events: [event(1, 'turn_start'), terminal],
    }));
    const f = fixture(recover);
    f.listener(terminal);
    await f.attachment.recover();
    await f.attachment.recover();
    expect(f.consume).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenLastCalledWith({ run: 2 });
    f.attachment.dispose();
  });

  it('keeps buffered traffic after failure and retries from the last applied cursor', async () => {
    const recover = vi
      .fn<() => Promise<RunRecoveryResult>>()
      .mockRejectedValueOnce(new Error('IPC offline'))
      .mockResolvedValueOnce({ schemaVersion: 1, events: [event(1, 'turn_start')] });
    const f = fixture(recover);
    f.listener(event(2));
    await f.attachment.recover();
    expect(f.onError).toHaveBeenCalledOnce();
    expect(f.consume).not.toHaveBeenCalled();
    await f.attachment.recover();
    expect(f.consume.mock.calls.map(([value]) => value.seq)).toEqual([1, 2]);
    f.attachment.dispose();
  });

  it('does not update a destroyed renderer after an in-flight recovery', async () => {
    const response = deferred<RunRecoveryResult>();
    const f = fixture(() => response.promise);
    const pending = f.attachment.recover();
    f.attachment.dispose();
    response.resolve({ schemaVersion: 1, events: [event(1)] });
    await pending;
    expect(f.consume).not.toHaveBeenCalled();
  });

  it('maintains independent cursors for concurrent designs', async () => {
    const other = {
      ...event(1, 'turn_start'),
      generationId: 'other',
      runId: 'other',
      designId: 'other-design',
    };
    const f = fixture(async () => ({ schemaVersion: 1, events: [event(1, 'turn_start'), other] }));
    await f.attachment.recover();
    f.listener(event(2));
    f.listener({ ...other, seq: 2 });
    expect(f.consume).toHaveBeenCalledTimes(4);
    f.attachment.dispose();
  });
});
