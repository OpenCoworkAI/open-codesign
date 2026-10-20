import { describe, expect, it, vi } from 'vitest';

vi.mock('../electron-runtime', () => ({
  app: { getPath: vi.fn(() => '/tmp/open-codesign-test') },
  ipcMain: { handle: vi.fn() },
}));

import {
  buildRunPreferenceAskInput,
  dropCurrentPromptEchoFromChatRows,
  shouldRunUserMemoryCandidateCapture,
} from './generate';

describe('generate IPC memory preference helpers', () => {
  it('captures user memory candidates only when the memory system and user auto-update are enabled', () => {
    expect(
      shouldRunUserMemoryCandidateCapture({
        memoryEnabled: true,
        userMemoryAutoUpdate: true,
      }),
    ).toBe(true);
    expect(
      shouldRunUserMemoryCandidateCapture({
        memoryEnabled: true,
        userMemoryAutoUpdate: false,
      }),
    ).toBe(false);
    expect(
      shouldRunUserMemoryCandidateCapture({
        memoryEnabled: false,
        userMemoryAutoUpdate: true,
      }),
    ).toBe(false);
  });
});

describe('generate IPC run preference preflight helpers', () => {
  it('builds clarification input from semantic router questions', () => {
    const input = buildRunPreferenceAskInput(
      [
        {
          id: 'bitmapAssets',
          type: 'text-options',
          prompt: 'Generate bitmap assets?',
          options: ['auto', 'no', 'yes'],
        },
      ],
      'This decides whether the first pass needs generated imagery.',
    );
    expect(input.rationale).toBe('This decides whether the first pass needs generated imagery.');
    expect(input.questions[0]).toMatchObject({
      id: 'bitmapAssets',
      type: 'text-options',
      options: ['auto', 'no', 'yes'],
    });
  });

  it('drops the optimistic current user row before main-process planning', () => {
    const rows = [
      {
        schemaVersion: 1,
        id: 0,
        designId: 'design-1',
        seq: 0,
        kind: 'user',
        payload: { text: 'make something cool' },
        snapshotId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ] as const;

    expect(dropCurrentPromptEchoFromChatRows([...rows], 'make something cool')).toEqual([]);
  });

  it('keeps real prior turns even when the prompt text differs', () => {
    const rows = [
      {
        schemaVersion: 1,
        id: 0,
        designId: 'design-1',
        seq: 0,
        kind: 'user',
        payload: { text: 'make something cool' },
        snapshotId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ] as const;

    expect(dropCurrentPromptEchoFromChatRows([...rows], 'make it brighter')).toHaveLength(1);
  });
});
