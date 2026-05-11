import { describe, expect, it } from 'vitest';
import {
  assertFinalizationGate,
  cloneResourceState,
  recordDone,
  recordMutation,
} from './resource-state.js';
import type { TextEditorFsCallbacks } from './tools/text-editor.js';

function makeFs(initial: Record<string, string> = {}): TextEditorFsCallbacks {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    view(path) {
      const c = map.get(path);
      return c === undefined ? null : { content: c, numLines: c.split('\n').length };
    },
    create(path, content) {
      map.set(path, content);
      return { path };
    },
    strReplace(path, oldStr, newStr) {
      const cur = map.get(path);
      if (cur === undefined) throw new Error('not found');
      map.set(path, cur.replace(oldStr, newStr));
      return { path };
    },
    insert(path) {
      return { path };
    },
    listDir(dir = '.') {
      const prefix = dir === '.' || dir.length === 0 ? '' : `${dir.replace(/\/$/, '')}/`;
      return [...map.keys()].filter((path) => path.startsWith(prefix)).sort();
    },
  };
}

describe('resource finalization gate', () => {
  it('accepts a non-renderable done target for document-first work', () => {
    const state = cloneResourceState(undefined);
    recordMutation(state);
    recordDone(state, { status: 'ok', path: 'design-brief.md', errorCount: 0 });

    expect(
      assertFinalizationGate({
        state,
        fs: makeFs({ 'design-brief.md': '# Design brief\n\nA handoff document.' }),
        enforce: true,
      }),
    ).toEqual([]);
  });

  it('surfaces optional skill quality misses as warnings instead of blocking artifacts', () => {
    const state = cloneResourceState(undefined);
    state.loadedSkills.push('craft-polish');
    recordMutation(state);
    recordDone(state, { status: 'ok', path: 'App.jsx', errorCount: 0 });

    expect(
      assertFinalizationGate({
        state,
        fs: makeFs({
          'App.jsx': 'export default function App() { return <button>Save</button>; }',
        }),
        enforce: true,
      }),
    ).toEqual([
      'Loaded skill craft-polish, but App.jsx is missing basic focus, hover, or non-happy-path state signals.',
    ]);
  });

  it('keeps a generated artifact available when done was skipped', () => {
    const state = cloneResourceState(undefined);
    recordMutation(state);

    expect(
      assertFinalizationGate({
        state,
        fs: makeFs({ 'App.jsx': 'export default function App() { return <main>Saved</main>; }' }),
        enforce: true,
        allowUnresolvedDoneWithArtifact: true,
      }),
    ).toEqual([
      'The agent edited the workspace but did not call done(status="ok"); keeping the generated artifact available.',
    ]);
  });

  it('keeps a generated artifact available when edits happened after done', () => {
    const state = cloneResourceState(undefined);
    recordMutation(state);
    recordDone(state, { status: 'ok', path: 'App.jsx', errorCount: 0 });
    state.mutationSeq += 1;

    expect(
      assertFinalizationGate({
        state,
        fs: makeFs({ 'App.jsx': 'export default function App() { return <main>Updated</main>; }' }),
        enforce: true,
        allowUnresolvedDoneWithArtifact: true,
      }),
    ).toEqual([
      'The workspace changed after the last successful done() call; keeping the latest artifact available.',
    ]);
  });
});
