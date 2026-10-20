import { describe, expect, it, vi } from 'vitest';

vi.mock('../electron-runtime', () => ({
  app: { getPath: vi.fn(() => '/tmp/open-codesign-test') },
  ipcMain: { handle: vi.fn() },
}));

import {
  buildRunPreferenceAskInput,
  dropCurrentPromptEchoFromChatRows,
  normalizeGenerationFailure,
  shouldRunUserMemoryCandidateCapture,
} from './generate';

describe('generation failure recovery context', () => {
  function normalize(err: unknown) {
    return normalizeGenerationFailure({
      err,
      signal: new AbortController().signal,
      provider: 'custom-relay',
      modelId: 'test-model',
      baseUrl: 'https://relay.example/v1',
      wire: 'openai-chat',
    });
  }

  it('tags an unsupported role without misclassifying the gateway', () => {
    const err = Object.assign(new Error('unsupported role: developer'), { status: 400 });
    expect(normalize(err).error).toMatchObject({
      upstream_recovery_category: 'model_not_supported_role',
      upstream_status: 400,
      upstream_provider: 'custom-relay',
      upstream_model_id: 'test-model',
    });
  });

  it('keeps nested network cause identity for renderer diagnostics', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(normalize(err).error).toMatchObject({
      upstream_recovery_category: 'network_unreachable',
      upstream_code: 'ECONNREFUSED',
    });
  });

  it('uses structured SDK error messages and preserves upstream context', () => {
    const err = {
      response: { status: 400, data: { error: { message: 'unsupported role: system' } } },
      upstream_provider: 'original-provider',
    };
    expect(normalize(err).error).toMatchObject({
      upstream_recovery_category: 'model_not_supported_role',
      upstream_status: 400,
      upstream_provider: 'original-provider',
    });
  });
});

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
