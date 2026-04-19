/**
 * Tests for the streaming artifact parser.
 */
import { describe, expect, it } from 'vitest';
import { createArtifactParser } from './parser';

function collectEvents(chunks: string[]): unknown[] {
  const parser = createArtifactParser();
  const events: unknown[] = [];
  for (const chunk of chunks) {
    for (const ev of parser.feed(chunk)) events.push(ev);
  }
  for (const ev of parser.flush()) events.push(ev);
  return events;
}

describe('artifact parser', () => {
  it('emits text-only events when no artifact tag is present', () => {
    expect(collectEvents(['hello ', 'world'])).toEqual([
      { type: 'text', delta: 'hello ' },
      { type: 'text', delta: 'world' },
    ]);
  });

  it('parses a complete artifact in a single chunk', () => {
    const events = collectEvents([
      'before <artifact identifier="a1" type="html" title="Hello">body</artifact> after',
    ]);
    expect(events).toEqual([
      { type: 'text', delta: 'before ' },
      { type: 'artifact:start', identifier: 'a1', artifactType: 'html', title: 'Hello' },
      { type: 'artifact:chunk', identifier: 'a1', delta: 'body' },
      { type: 'artifact:end', identifier: 'a1', fullContent: 'body' },
      { type: 'text', delta: ' after' },
    ]);
  });

  it('handles open tag split across deltas', () => {
    const events = collectEvents([
      '<arti',
      'fact identifier="a1" type="html" title="t">x</artifact>',
    ]);
    expect(events[0]).toEqual({
      type: 'artifact:start',
      identifier: 'a1',
      artifactType: 'html',
      title: 't',
    });
  });

  it('handles open tag split mid-attribute (between attrs, before final ">")', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html"',
      ' title="t">body</artifact>',
    ]);
    expect(events[0]).toEqual({
      type: 'artifact:start',
      identifier: 'a1',
      artifactType: 'html',
      title: 't',
    });
    const endEvent = events.find(
      (e): e is { type: 'artifact:end'; identifier: string; fullContent: string } =>
        (e as { type: string }).type === 'artifact:end',
    );
    expect(endEvent?.fullContent).toBe('body');
    const textLeak = events.find(
      (e) => (e as { type: string }).type === 'text' && /<artifact/i.test((e as { delta: string }).delta),
    );
    expect(textLeak).toBeUndefined();
  });

  it('handles close tag split across deltas', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t">hello</art',
      'ifact>',
    ]);
    const endEvent = events.find(
      (e): e is { type: 'artifact:end'; identifier: string; fullContent: string } =>
        (e as { type: string }).type === 'artifact:end',
    );
    expect(endEvent?.fullContent).toBe('hello');
  });

  it('flushes a truncated artifact as a final end event', () => {
    const events = collectEvents(['<artifact identifier="a1" type="html" title="t">unfinished']);
    const last = events[events.length - 1] as { type: string; fullContent?: string };
    expect(last.type).toBe('artifact:end');
    expect(last.fullContent).toBe('unfinished');
  });

  it('does not stall on words that merely start with "<artifact" (letter follows)', () => {
    const events = collectEvents(['the <artifactual data', ' here']);
    const text = events
      .filter((e): e is { type: 'text'; delta: string } => (e as { type: string }).type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('the <artifactual data here');
    expect(events.some((e) => (e as { type: string }).type === 'artifact:start')).toBe(false);
  });

  it('does not stall on "<artifact-like" (dash follows)', () => {
    const events = collectEvents(['something <artifact-like', ' suffix']);
    const text = events
      .filter((e): e is { type: 'text'; delta: string } => (e as { type: string }).type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('something <artifact-like suffix');
    expect(events.some((e) => (e as { type: string }).type === 'artifact:start')).toBe(false);
  });
});
