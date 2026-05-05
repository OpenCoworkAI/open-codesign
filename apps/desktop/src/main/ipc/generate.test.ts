import { describe, expect, it, vi } from 'vitest';

vi.mock('../electron-runtime', () => ({
  app: { getPath: vi.fn(() => '/tmp/open-codesign-test') },
  ipcMain: { handle: vi.fn() },
}));

import {
  buildRunPreferenceAskInput,
  contextWindowForContextPack,
  shouldRunUserMemoryCandidateCapture,
} from './generate';

describe('generate IPC context budget helpers', () => {
  it('uses active model contextWindow when the model object exposes it', () => {
    expect(
      contextWindowForContextPack({ provider: 'p', modelId: 'm', contextWindow: 64_000 }),
    ).toBe(64_000);
  });

  it('falls back to the harness default when model metadata lacks contextWindow', () => {
    expect(contextWindowForContextPack({ provider: 'p', modelId: 'm' })).toBe(200_000);
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
    const input = buildRunPreferenceAskInput([
      {
        id: 'bitmapAssets',
        type: 'text-options',
        prompt: 'Generate bitmap assets?',
        options: ['auto', 'no', 'yes'],
      },
    ]);
    expect(input.questions[0]).toMatchObject({
      id: 'bitmapAssets',
      type: 'text-options',
      options: ['auto', 'no', 'yes'],
    });
  });
});
