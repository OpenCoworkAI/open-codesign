/**
 * Tests for the streaming artifact parser.
 */
import { describe, expect, it } from 'vitest';
import { type ArtifactEvent, createArtifactParser } from './parser';

function collectEvents(chunks: string[]): ArtifactEvent[] {
  const parser = createArtifactParser();
  const events: ArtifactEvent[] = [];
  for (const chunk of chunks) {
    for (const ev of parser.feed(chunk)) events.push(ev);
  }
  for (const ev of parser.flush()) events.push(ev);
  return events;
}

function joinText(events: ArtifactEvent[]): string {
  return events
    .filter((e): e is Extract<ArtifactEvent, { type: 'text' }> => e.type === 'text')
    .map((e) => e.delta)
    .join('');
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
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(endEvent?.fullContent).toBe('body');
    const textLeak = events.find((e) => e.type === 'text' && /<artifact/i.test(e.delta));
    expect(textLeak).toBeUndefined();
  });

  it('handles close tag split across deltas', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t">hello</art',
      'ifact>',
    ]);
    const endEvent = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(endEvent?.fullContent).toBe('hello');
  });

  it('handles close tag split character by character', () => {
    const chunks = [
      '<artifact identifier="a1" type="html" title="t">hello',
      ...Array.from('</artifact>'),
    ];
    const events = collectEvents(chunks);
    const endEvent = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(endEvent?.fullContent).toBe('hello');
    const textLeak = events.find((e) => e.type === 'text' && /<\/?artifact/.test(e.delta));
    expect(textLeak).toBeUndefined();
  });

  it('flushes a truncated artifact as a final end event', () => {
    const events = collectEvents(['<artifact identifier="a1" type="html" title="t">unfinished']);
    const last = events[events.length - 1] as Extract<ArtifactEvent, { type: 'artifact:end' }>;
    expect(last.type).toBe('artifact:end');
    expect(last.fullContent).toBe('unfinished');
  });

  it('does not stall on words that merely start with "<artifact" (letter follows)', () => {
    const events = collectEvents(['the <artifactual data', ' here']);
    expect(joinText(events)).toBe('the <artifactual data here');
    expect(events.some((e) => e.type === 'artifact:start')).toBe(false);
  });

  it('does not stall on "<artifact-like" (dash follows)', () => {
    const events = collectEvents(['something <artifact-like', ' suffix']);
    expect(joinText(events)).toBe('something <artifact-like suffix');
    expect(events.some((e) => e.type === 'artifact:start')).toBe(false);
  });

  // --- Leak audit tests (added in fix(artifacts): close remaining streaming parser leak paths) ---

  it('parses attribute values that contain ">" (unescaped greater-than in title)', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="a > b">body</artifact>',
    ]);
    const start = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    expect(start).toEqual({
      type: 'artifact:start',
      identifier: 'a1',
      artifactType: 'html',
      title: 'a > b',
    });
    const end = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(end?.fullContent).toBe('body');
  });

  it('parses ">" inside a single-quoted attribute value', () => {
    const events = collectEvents([
      "<artifact identifier='a1' type='html' title='x > y'>body</artifact>",
    ]);
    const start = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    expect(start?.title).toBe('x > y');
  });

  it('does not leak the open tag when a streamed split lands inside a ">"-bearing attribute value', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="a >',
      ' b">body</artifact>',
    ]);
    expect(events.some((e) => e.type === 'text' && /<artifact/i.test(e.delta))).toBe(false);
    const start = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    expect(start?.title).toBe('a > b');
    const end = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(end?.fullContent).toBe('body');
  });

  it('handles two artifacts in a single stream without state leak', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t1">one</artifact>',
      ' middle ',
      '<artifact identifier="a2" type="html" title="t2">two</artifact>',
    ]);
    const starts = events.filter(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    const ends = events.filter(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(starts.map((s) => s.identifier)).toEqual(['a1', 'a2']);
    expect(ends.map((e) => e.fullContent)).toEqual(['one', 'two']);
    expect(joinText(events)).toBe(' middle ');
  });

  it('handles two back-to-back artifacts with the close+open boundary in one chunk', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t1">one</artifact><artifact identifier="a2" type="html" title="t2">',
      'two</artifact>',
    ]);
    const ends = events.filter(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(ends.map((e) => e.fullContent)).toEqual(['one', 'two']);
  });

  it('handles a multi-line open tag with newlines between attributes', () => {
    const events = collectEvents([
      '<artifact\n  identifier="a1"\n  type="html"\n  title="t"\n>body</artifact>',
    ]);
    const start = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    expect(start).toEqual({
      type: 'artifact:start',
      identifier: 'a1',
      artifactType: 'html',
      title: 't',
    });
  });

  it('passes literal "<" in body through to artifact content (not confused with start-of-tag)', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t"><div>1 < 2 && 3 > 0</div></artifact>',
    ]);
    const end = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(end?.fullContent).toBe('<div>1 < 2 && 3 > 0</div>');
  });

  it('passes a literal "<artifact" inside body content through unchanged', () => {
    const events = collectEvents([
      '<artifact identifier="a1" type="html" title="t">A code sample: <artifact id="x"> is the opening tag.</artifact>',
    ]);
    const end = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:end' }> => e.type === 'artifact:end',
    );
    expect(end?.fullContent).toBe('A code sample: <artifact id="x"> is the opening tag.');
  });

  it('treats a bare <artifact> (no attributes) as plain prose, not an artifact tag', () => {
    const events = collectEvents(['the <artifact>plain</artifact> token in prose']);
    expect(events.some((e) => e.type === 'artifact:start')).toBe(false);
    expect(joinText(events)).toBe('the <artifact>plain</artifact> token in prose');
  });

  it('still recognizes a real <artifact identifier=... type=...> open tag', () => {
    const events = collectEvents(['<artifact identifier="a1" type="html">body</artifact>']);
    const start = events.find(
      (e): e is Extract<ArtifactEvent, { type: 'artifact:start' }> => e.type === 'artifact:start',
    );
    expect(start).toEqual({
      type: 'artifact:start',
      identifier: 'a1',
      artifactType: 'html',
      title: '',
    });
  });
});
