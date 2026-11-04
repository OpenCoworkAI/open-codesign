import { describe, expect, it } from 'vitest';
import { selectGoalMemory } from './goal-memory.js';
import type { StateEvent } from './state-evaluation.js';

const event = (
  id: string,
  seq: number,
  text: string,
  authority: 'user' | 'tool' = 'user',
  designId = 'A',
  revision: string | null = null,
): StateEvent => ({ id, seq, text, authority, designId, revision });
const noise = Array.from({ length: 8 }, (_, i) =>
  event(`noise${i}`, i + 10, `diagnostics.json ${'x'.repeat(200)}`, 'tool'),
);
const select = (events: StateEvent[], byteLimit = 1000, goal = 'continue') =>
  selectGoalMemory({ events, byteLimit, goal, cutoff: 100 });

describe('goal archive selection', () => {
  it('ranks public goals even without a user design selection', () => {
    const events = [
      event('footer', 0, 'footer link layout', 'tool'),
      event('header', 1, 'header title layout', 'tool'),
    ];
    const cap =
      Math.max(
        ...events.map((e) => Buffer.byteLength(JSON.stringify({ goal: 'footer', events: [e] }))),
      ) + 1;
    expect(select(events, cap, 'footer').selectedEventIds).toEqual(['footer']);
    expect(select(events, cap, 'header').selectedEventIds).toEqual(['header']);
  });
  it('admits a correction with its predecessor as one bundle at every capacity', () => {
    const events = [
      event('old', 0, 'App.jsx font Inter'),
      event('new', 1, '纠正 App.jsx font Georgia，替代 Inter'),
      ...noise,
    ];
    for (const cap of [200, 300, 400, 600, 1000]) {
      const result = select(events, cap, 'font');
      expect(result.selectedEventIds.includes('old')).toBe(result.selectedEventIds.includes('new'));
      expect(result.memoryBytes).toBeLessThanOrEqual(cap);
    }
  });
  it('keeps revision receipts and their invalidating observation together', () => {
    const events = [
      event('r1', 0, 'read App.jsx revision r1; preview r1 passed', 'tool', 'A', 'r1'),
      event('r2', 1, 'read App.jsx current revision r2; external edit', 'tool', 'A', 'r2'),
      ...noise,
    ];
    for (const cap of [200, 300, 400, 600, 1000]) {
      const result = select(events, cap, 'App.jsx');
      expect(result.selectedEventIds.includes('r1')).toBe(result.selectedEventIds.includes('r2'));
    }
    expect(select(events, 1000, 'App.jsx').selectedEventIds).toEqual(
      expect.arrayContaining(['r1', 'r2']),
    );
  });
  it('retains full short evidence including original source fields without mutating input', () => {
    const events = [
      event('a', 0, 'workspace w global: prohibit animations'),
      event('b', 1, 'local decision', 'user', 'B'),
    ];
    const before = structuredClone(events),
      a = select(events),
      b = select(events);
    expect(a.allEventsFit).toBe(true);
    expect(a.frozenMemory).toBe(b.frozenMemory);
    expect(JSON.parse(a.frozenMemory)).toEqual({ goal: 'continue', events });
    expect(events).toEqual(before);
    expect(a.memoryBytes).toBe(Buffer.byteLength(a.frozenMemory));
    expect(a.archiveAccess).toBe(true);
  });
  it('does not classify future text or derive scope from a tool', () => {
    const future = event('future', 101, 'future');
    Object.defineProperty(future, 'text', {
      get: () => {
        throw Error('future accessed');
      },
    });
    const events = [
      event('global', 0, '全局限制：所有设计禁止动画'),
      event('localA', 1, 'A red'),
      event('localB', 2, '切换到 design B，字体尚未决定', 'user', 'B'),
      ...noise.map((e) => ({ ...e, designId: 'A' })),
      future,
    ];
    const result = select(events);
    expect(result.activeDesignId).toBe('B');
    expect(result.selectedEventIds).toEqual(expect.arrayContaining(['global', 'localB']));
    expect(result.selectedEventIds).not.toContain('localA');
    expect(result.scannedEventIds).not.toContain('future');
  });
  it('omits oversized Unicode events whole and rejects impossible envelopes', () => {
    const events = [event('huge', 0, '中'.repeat(3000))];
    const result = select(events, 200);
    expect(JSON.parse(result.frozenMemory).events).toEqual([]);
    expect(result.memoryBytes).toBeLessThanOrEqual(200);
    expect(() => select(events, 1)).toThrow();
    expect(() => select(events, -1)).toThrow();
  });
});
