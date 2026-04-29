import type { EngineeringLogLine } from '@open-codesign/shared';

/** Bounded ring buffer for stdout/stderr lines. The producer side caps log
 *  growth so a long-running dev server cannot exhaust desktop memory. */
export class LogRingBuffer {
  private readonly capacity: number;
  private readonly buffer: EngineeringLogLine[] = [];
  private nextSeq = 0;

  constructor(capacity = 500) {
    if (capacity <= 0) throw new Error('LogRingBuffer capacity must be positive');
    this.capacity = capacity;
  }

  push(stream: 'stdout' | 'stderr', text: string): EngineeringLogLine {
    const line: EngineeringLogLine = {
      schemaVersion: 1,
      seq: this.nextSeq++,
      stream,
      text,
      ts: new Date().toISOString(),
    };
    this.buffer.push(line);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    return line;
  }

  /** Snapshot of current buffer contents in chronological order. */
  snapshot(): EngineeringLogLine[] {
    return [...this.buffer];
  }

  /** Most recent N lines, defaulting to the full snapshot. Used for error
   *  excerpts in EngineeringError.excerpt. */
  tail(n: number = this.capacity): string[] {
    const start = Math.max(0, this.buffer.length - n);
    return this.buffer.slice(start).map((l) => l.text);
  }

  reset(): void {
    this.buffer.length = 0;
    this.nextSeq = 0;
  }
}
