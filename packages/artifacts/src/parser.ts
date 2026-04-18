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

const OPEN_TAG_RE = /<artifact\s+([^>]*?)>/;
const CLOSE_TAG = '</artifact>';

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
        const open = OPEN_TAG_RE.exec(state.buffer);
        if (!open) {
          // No open tag in buffer. Emit everything except a possible partial '<artifact'
          const safeUpTo = findSafeFlushPoint(state.buffer);
          if (safeUpTo > 0) {
            yield { type: 'text', delta: state.buffer.slice(0, safeUpTo) };
            state.buffer = state.buffer.slice(safeUpTo);
          }
          return;
        }

        if (open.index > 0) {
          yield { type: 'text', delta: state.buffer.slice(0, open.index) };
        }

        const attrs = parseAttrs(open[1] as string);
        state.inside = true;
        state.identifier = attrs['identifier'] ?? '';
        state.artifactType = attrs['type'] ?? '';
        state.title = attrs['title'] ?? '';
        state.content = '';
        state.buffer = state.buffer.slice(open.index + open[0].length);

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
 * Strip Markdown code fences whose body is empty (or whitespace only).
 *
 * When the model wraps an `<artifact>` tag in a ```html ... ``` fence, the
 * artifact parser pulls the artifact out cleanly but leaves the fence pair
 * behind in the surrounding text. The empty pair would then surface as a
 * meaningless assistant bubble in the chat. Fences with real content (e.g. a
 * code sample the model wanted to show) are preserved.
 */
export function stripEmptyCodeFences(text: string): string {
  if (text.length === 0) return text;
  const cleaned = text.replace(/```[a-zA-Z0-9_-]*\s*```/g, '');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Find the largest index up to which we can safely emit text without
 * potentially splitting an "<artifact" prefix in two.
 */
function findSafeFlushPoint(buffer: string): number {
  const ltIdx = buffer.lastIndexOf('<');
  if (ltIdx === -1) return buffer.length;
  const tail = buffer.slice(ltIdx);
  if ('<artifact'.startsWith(tail)) return ltIdx;
  return buffer.length;
}
