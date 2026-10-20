/**
 * Detects a run that keeps repeating the same tool call.
 *
 * Two signals, both by tool name plus validated arguments:
 *   - the same call several times in a row;
 *   - a short cycle of calls (up to MAX_CYCLE_LENGTH) that repeats unchanged.
 *
 * A call with different arguments breaks both patterns, so edits to different
 * ranges or with different content never count. There is no total per tool:
 * a large design legitimately makes dozens of edits. Every call counts,
 * including calls the host blocked after a warning, so a model that ignores
 * the warning still reaches the halt.
 *
 * The guard only looks at calls; the caller decides what a warning or a halt
 * does. State belongs to one generation and lives as long as the guard does.
 */

export const TOOL_LOOP_WARN_REPEATS = 3;
export const TOOL_LOOP_HALT_REPEATS = 5;
export const TOOL_LOOP_MAX_CYCLE_LENGTH = 3;

export interface ToolLoopCall {
  name: string;
  args: unknown;
}

export type ToolLoopVerdict =
  | { action: 'ok' }
  | {
      action: 'warn' | 'halt';
      /** Times the pattern has repeated back to back, this call included. */
      repeats: number;
      /** Tool names of the repeating pattern, in call order. */
      cycle: string[];
    };

export interface ToolLoopGuard {
  check(call: ToolLoopCall): ToolLoopVerdict;
  reset(): void;
}

interface RecordedCall {
  name: string;
  key: string;
}

const HISTORY_LIMIT = TOOL_LOOP_HALT_REPEATS * TOOL_LOOP_MAX_CYCLE_LENGTH;

/** Order-independent serialization, so key order never hides a repeat. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameKeys(history: RecordedCall[], start: number, other: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (history[start + i]?.key !== history[other + i]?.key) return false;
  }
  return true;
}

/** How many times the last `length` calls repeat back to back, counting themselves. */
function trailingRepeats(history: RecordedCall[], length: number): number {
  if (history.length < length) return 0;
  const block = history.length - length;
  let repeats = 1;
  while (
    history.length >= (repeats + 1) * length &&
    sameKeys(history, block, block - repeats * length, length)
  ) {
    repeats += 1;
  }
  return repeats;
}

export function createToolLoopGuard(): ToolLoopGuard {
  let history: RecordedCall[] = [];
  return {
    check(call) {
      history.push({ name: call.name, key: `${call.name}\u0000${canonicalJson(call.args)}` });
      if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
      let repeats = 0;
      let length = 1;
      for (let candidate = 1; candidate <= TOOL_LOOP_MAX_CYCLE_LENGTH; candidate++) {
        const found = trailingRepeats(history, candidate);
        if (found > repeats) {
          repeats = found;
          length = candidate;
        }
      }
      if (repeats < TOOL_LOOP_WARN_REPEATS) return { action: 'ok' };
      return {
        action: repeats >= TOOL_LOOP_HALT_REPEATS ? 'halt' : 'warn',
        repeats,
        cycle: history.slice(-length).map((recorded) => recorded.name),
      };
    },
    reset() {
      history = [];
    },
  };
}
