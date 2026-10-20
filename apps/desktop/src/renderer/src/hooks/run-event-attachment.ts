import type { AgentStreamEvent, RunRecoveryResult } from '../../../preload/index';

/** Subscribe first, then replay; live traffic is buffered across the IPC snapshot. */
export function attachRunEvents(options: {
  subscribe: (listener: (event: AgentStreamEvent) => void) => () => void;
  recover: (cursors: Record<string, number>) => Promise<RunRecoveryResult>;
  consume: (event: AgentStreamEvent, replay: boolean) => void;
  onError: (error: unknown) => void;
}): { recover: () => Promise<void>; dispose: () => void } {
  const cursors = new Map<string, number>();
  let disposed = false;
  let syncing: Promise<void> | null = null;
  let buffering = true;
  let buffered: AgentStreamEvent[] = [];
  const deliver = (event: AgentStreamEvent, replay: boolean): void => {
    if (disposed) return;
    if (event.seq !== undefined) {
      const cursor = cursors.get(event.generationId) ?? 0;
      if (event.seq <= cursor) return;
      if (event.seq !== cursor + 1) {
        buffered.push(event);
        return;
      }
      options.consume(event, replay);
      cursors.set(event.generationId, event.seq);
    } else {
      options.consume(event, replay);
    }
  };
  const recover = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (syncing) return syncing;
    buffering = true;
    syncing = Promise.resolve()
      .then(async () => {
        const result = await options.recover(Object.fromEntries(cursors));
        if (disposed) return;
        for (const event of result.events) deliver(event, true);
        const pending = buffered;
        buffered = [];
        for (const event of pending.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)))
          deliver(event, false);
      })
      .catch(options.onError)
      .finally(() => {
        const pending = buffered;
        buffered = [];
        for (const event of pending.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)))
          deliver(event, false);
        buffering = false;
        syncing = null;
      });
    return syncing;
  };
  const off = options.subscribe((event) => {
    if (buffering) {
      buffered.push(event);
      return;
    }
    deliver(event, false);
    if (buffered.length > 0) void recover();
  });
  void recover();
  return {
    recover,
    dispose() {
      disposed = true;
      off();
      buffered = [];
    },
  };
}
