/**
 * Streaming parser for Claude Artifacts <artifact ...>...</artifact> tags.
 * Feed it text deltas; iterate events.
 *
 * Tier 1: handles a single artifact at a time, no nested tags.
 * Tier 2 will add multi-artifact, identifier collisions, type validation.
 */

export interface ArtifactStartEvent {
  type: 'artifact:start';
  identifier: string;
  artifactType: string;
  title: string;
}

export interface ArtifactChunkEvent {
  type: 'artifact:chunk';
  identifier: string;
  delta: string;
}

export interface ArtifactEndEvent {
  type: 'artifact:end';
  identifier: string;
  fullContent: string;
}

export interface TextEvent {
  type: 'text';
  delta: string;
}

export type ArtifactEvent = ArtifactStartEvent | ArtifactChunkEvent | ArtifactEndEvent | TextEvent;

interface ParserState {
  inside: boolean;
  buffer: string;
  identifier: string;
  artifactType: string;
  title: string;
  content: string;
}

const OPEN_PREFIX = '<artifact';
const CLOSE_TAG = '</artifact>';

type OpenTagMatch =
  | { kind: 'complete'; start: number; end: number; attrs: string }
  | { kind: 'partial'; start: number }
  | { kind: 'none' };

export function createArtifactParser() {
  const state: ParserState = {
    inside: false,
    buffer: '',
    identifier: '',
    artifactType: '',
    title: '',
    content: '',
  };

  function parseAttrs(raw: string): Record<string, string> {
    // Local regex instance — `/g` flag carries `lastIndex` state, so a
    // module-level singleton would leak state between calls.
    const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const out: Record<string, string> = {};
    let match: RegExpExecArray | null = attrRe.exec(raw);
    while (match !== null) {
      const key = match[1] as string;
      const value = (match[2] ?? match[3] ?? '') as string;
      out[key] = value;
      match = attrRe.exec(raw);
    }
    return out;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stream parsers are inherently branchy; refactoring would reduce clarity
  function* feed(delta: string): Generator<ArtifactEvent> {
    state.buffer += delta;

    while (state.buffer.length > 0) {
      if (!state.inside) {
        const open = findOpenTag(state.buffer);
        if (open.kind === 'none') {
          yield { type: 'text', delta: state.buffer };
          state.buffer = '';
          return;
        }
        if (open.kind === 'partial') {
          if (open.start > 0) {
            yield { type: 'text', delta: state.buffer.slice(0, open.start) };
            state.buffer = state.buffer.slice(open.start);
          }
          return;
        }

        if (open.start > 0) {
          yield { type: 'text', delta: state.buffer.slice(0, open.start) };
        }

        const attrs = parseAttrs(open.attrs);
        state.inside = true;
        state.identifier = attrs['identifier'] ?? '';
        state.artifactType = attrs['type'] ?? '';
        state.title = attrs['title'] ?? '';
        state.content = '';
        state.buffer = state.buffer.slice(open.end);

        yield {
          type: 'artifact:start',
          identifier: state.identifier,
          artifactType: state.artifactType,
          title: state.title,
        };
        continue;
      }

      const closeIdx = state.buffer.indexOf(CLOSE_TAG);
      if (closeIdx === -1) {
        // Hold back enough to detect a partial close tag at the very end.
        const flushUpTo = state.buffer.length - (CLOSE_TAG.length - 1);
        if (flushUpTo > 0) {
          const chunk = state.buffer.slice(0, flushUpTo);
          state.content += chunk;
          state.buffer = state.buffer.slice(flushUpTo);
          yield { type: 'artifact:chunk', identifier: state.identifier, delta: chunk };
        }
        return;
      }

      const finalChunk = state.buffer.slice(0, closeIdx);
      if (finalChunk.length > 0) {
        state.content += finalChunk;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: finalChunk };
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };

      state.buffer = state.buffer.slice(closeIdx + CLOSE_TAG.length);
      state.inside = false;
      state.identifier = '';
      state.artifactType = '';
      state.title = '';
      state.content = '';
    }
  }

  function* flush(): Generator<ArtifactEvent> {
    if (state.inside) {
      // Truncated artifact at end of stream. Treat what we have, including
      // any text held back as a possible partial close tag, as final content.
      if (state.buffer.length > 0) {
        state.content += state.buffer;
        yield { type: 'artifact:chunk', identifier: state.identifier, delta: state.buffer };
        state.buffer = '';
      }
      yield { type: 'artifact:end', identifier: state.identifier, fullContent: state.content };
    } else if (state.buffer.length > 0) {
      yield { type: 'text', delta: state.buffer };
    }
    state.buffer = '';
    state.inside = false;
  }

  return { feed, flush };
}

/**
 * Locate the next `<artifact ...>` open tag in `buffer`, scanning attribute
 * values in a quote-aware manner so that a `>` inside a quoted attribute
 * value (e.g. `title="a > b"`) does not prematurely terminate the tag.
 *
 * Returns:
 *   - `complete`: a full open tag is present in the buffer
 *   - `partial`:  a candidate prefix is present but the closing `>` (or
 *                 enough of `<artifact` itself) hasn't arrived yet — caller
 *                 must hold back from `start` and wait for more input
 *   - `none`:     no candidate; caller may flush the entire buffer as text
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: quote-aware tag scanning is inherently branchy; splitting hurts clarity
function findOpenTag(buffer: string): OpenTagMatch {
  let from = 0;
  while (from <= buffer.length) {
    const idx = buffer.indexOf(OPEN_PREFIX, from);
    if (idx === -1) {
      // No full `<artifact` left. Maybe a strict prefix at the tail (e.g. `<art`).
      const tail = buffer.lastIndexOf('<', buffer.length - 1);
      if (tail !== -1) {
        const slice = buffer.slice(tail);
        if (OPEN_PREFIX.startsWith(slice) && slice.length < OPEN_PREFIX.length) {
          return { kind: 'partial', start: tail };
        }
      }
      return { kind: 'none' };
    }

    const afterPrefix = idx + OPEN_PREFIX.length;
    const next = buffer.charAt(afterPrefix);
    if (next === '') {
      // Buffer ends exactly at `<artifact`; can't yet decide if it's a real tag.
      return { kind: 'partial', start: idx };
    }
    if (next !== '>' && !/\s/.test(next)) {
      // `<artifactual`, `<artifact-like`, etc. — not our tag, keep searching.
      from = afterPrefix;
      continue;
    }

    // Scan forward for the closing `>` while respecting quoted attribute values.
    let i = afterPrefix;
    let quote: '"' | "'" | null = null;
    while (i < buffer.length) {
      const c = buffer.charAt(i);
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        return {
          kind: 'complete',
          start: idx,
          end: i + 1,
          attrs: buffer.slice(afterPrefix, i),
        };
      }
      i++;
    }
    // Reached end of buffer without finding the closing `>`.
    return { kind: 'partial', start: idx };
  }
  return { kind: 'none' };
}
