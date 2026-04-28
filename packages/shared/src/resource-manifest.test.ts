import { describe, expect, it } from 'vitest';
import { deriveResourceStateFromChatRows } from './resource-manifest';
import type { ChatMessageRow } from './snapshot';

function row(seq: number, payload: Record<string, unknown>): ChatMessageRow {
  return {
    schemaVersion: 1,
    id: seq,
    designId: 'd1',
    seq,
    kind: 'tool_call',
    payload,
    snapshotId: null,
    createdAt: '2026-04-28T00:00:00.000Z',
  };
}

describe('deriveResourceStateFromChatRows', () => {
  it('replays loaded resources, mutations, scaffolds, and done state', () => {
    const state = deriveResourceStateFromChatRows([
      row(0, {
        toolName: 'skill',
        args: { name: 'chart-rendering' },
        status: 'done',
        result: { details: { name: 'chart-rendering', status: 'loaded' } },
        startedAt: '2026-04-28T00:00:00.000Z',
        verbGroup: 'Working',
      }),
      row(1, {
        toolName: 'scaffold',
        args: { kind: 'iphone-frame', destPath: 'frames/iphone.jsx' },
        status: 'done',
        result: {
          details: {
            ok: true,
            kind: 'iphone-frame',
            destPath: 'frames/iphone.jsx',
            bytes: 42,
          },
        },
        startedAt: '2026-04-28T00:00:00.000Z',
        verbGroup: 'Working',
      }),
      row(2, {
        toolName: 'str_replace_based_edit_tool',
        command: 'create',
        args: { path: 'index.html' },
        status: 'done',
        startedAt: '2026-04-28T00:00:00.000Z',
        verbGroup: 'Working',
      }),
      row(3, {
        toolName: 'done',
        args: { path: 'index.html' },
        status: 'done',
        result: { details: { status: 'ok', path: 'index.html', errors: [] } },
        startedAt: '2026-04-28T00:00:00.000Z',
        verbGroup: 'Working',
      }),
    ]);

    expect(state.loadedSkills).toEqual(['chart-rendering']);
    expect(state.scaffoldedFiles).toEqual([
      { kind: 'iphone-frame', destPath: 'frames/iphone.jsx', bytes: 42 },
    ]);
    expect(state.mutationSeq).toBe(2);
    expect(state.lastDone).toMatchObject({ status: 'ok', mutationSeq: 2 });
  });
});
