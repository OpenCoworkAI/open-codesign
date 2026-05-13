export interface AgentFsUpdate {
  designId: string;
  generationId: string;
  path: string;
  content: string;
}

export interface AgentFsUpdateScheduler {
  schedule(update: AgentFsUpdate): void;
  flushGeneration(generationId: string): void;
  clearGeneration(generationId: string): void;
  clear(): void;
  clearAll(): void;
}

export function createAgentFsUpdateScheduler<TimerId = ReturnType<typeof setTimeout>>(options: {
  delayMs: number;
  now?: () => number;
  setTimer: (callback: () => void, delayMs: number) => TimerId;
  clearTimer: (id: TimerId) => void;
  flush: (update: AgentFsUpdate) => void;
}): AgentFsUpdateScheduler {
  type Slot = {
    lastFlushAt: number;
    pending: AgentFsUpdate | null;
    timer: TimerId | null;
  };

  const slots = new Map<string, Slot>();
  const now = options.now ?? Date.now;
  const keyFor = (update: Pick<AgentFsUpdate, 'generationId' | 'path'>) =>
    `${update.generationId}\u0000${update.path}`;

  const flushSlot = (key: string, slot: Slot): void => {
    const pending = slot.pending;
    slot.pending = null;
    slot.timer = null;
    if (pending === null) return;
    slot.lastFlushAt = now();
    options.flush(pending);
  };

  return {
    schedule(update) {
      const key = keyFor(update);
      const slot = slots.get(key) ?? {
        lastFlushAt: now() - options.delayMs,
        pending: null,
        timer: null,
      };
      slots.set(key, slot);

      const since = now() - slot.lastFlushAt;
      if (since >= options.delayMs && slot.timer === null) {
        slot.lastFlushAt = now();
        options.flush(update);
        return;
      }

      slot.pending = update;
      if (slot.timer !== null) return;
      slot.timer = options.setTimer(
        () => flushSlot(key, slot),
        Math.max(options.delayMs - since, 0),
      );
    },

    flushGeneration(generationId) {
      for (const [key, slot] of [...slots.entries()]) {
        const pending = slot.pending;
        if (pending?.generationId !== generationId) continue;
        if (slot.timer !== null) {
          options.clearTimer(slot.timer);
        }
        flushSlot(key, slot);
      }
    },

    clearGeneration(generationId) {
      for (const [key, slot] of [...slots.entries()]) {
        if (!key.startsWith(`${generationId}\u0000`)) continue;
        if (slot.timer !== null) {
          options.clearTimer(slot.timer);
        }
        slots.delete(key);
      }
    },

    clear() {
      for (const slot of slots.values()) {
        if (slot.timer !== null) options.clearTimer(slot.timer);
      }
      slots.clear();
    },

    clearAll() {
      this.clear();
    },
  };
}
