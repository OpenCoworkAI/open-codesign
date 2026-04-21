import { initI18n } from '@open-codesign/i18n';
import type { OnboardingState } from '@open-codesign/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const READY_CONFIG: OnboardingState = {
  hasKey: true,
  provider: 'anthropic',
  modelPrimary: 'claude-sonnet-4-6',
  baseUrl: null,
  designSystem: null,
  sshProfiles: [],
};

const initialState = useCodesignStore.getState();

function resetStore() {
  useCodesignStore.setState({
    ...initialState,
    previewHtml: null,
    isGenerating: false,
    activeGenerationId: null,
    generationStage: 'idle',
    errorMessage: null,
    lastError: null,
    config: READY_CONFIG,
    configLoaded: true,
    toastMessage: null,
    iframeErrors: [],
    toasts: [],
  });
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  resetStore();
  vi.restoreAllMocks();
});

describe('generationStage transitions', () => {
  it('starts at idle', () => {
    expect(useCodesignStore.getState().generationStage).toBe('idle');
  });

  it('moves sending → thinking → streaming → parsing → rendering → done on success', async () => {
    const stages: string[] = [];

    const generate = vi.fn(
      () =>
        new Promise((resolve) => {
          // Record stage right when generate is called (should be 'thinking')
          stages.push(useCodesignStore.getState().generationStage);
          resolve({ artifacts: [{ content: '<html></html>' }], message: 'Done.' });
        }),
    );

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
    });

    const stagesBefore: string[] = [];
    const unsub = useCodesignStore.subscribe((s) => {
      const st = s.generationStage;
      const last = stagesBefore[stagesBefore.length - 1];
      if (st !== last) stagesBefore.push(st);
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'design something' });

    unsub();

    // Must pass through all 5 named stages before done
    expect(stagesBefore).toContain('sending');
    expect(stagesBefore).toContain('thinking');
    expect(stagesBefore).toContain('streaming');
    expect(stagesBefore).toContain('parsing');
    expect(stagesBefore).toContain('rendering');
    expect(stagesBefore).toContain('done');
    // done should be the final recorded stage
    expect(stagesBefore[stagesBefore.length - 1]).toBe('done');
  });

  it('sets generationStage to error on failure', async () => {
    const generate = vi.fn(() => Promise.reject(new Error('network fail')));

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'design something' });

    expect(useCodesignStore.getState().generationStage).toBe('error');
    expect(useCodesignStore.getState().isGenerating).toBe(false);
  });

  it('stage is sending synchronously at the start, then advances to done', async () => {
    // Use a map so each generation ID gets its own resolver
    const pending = new Map<
      string,
      (v: { artifacts: Array<{ content: string }>; message: string }) => void
    >();
    const generate = vi.fn((payload: { generationId: string }) => {
      return new Promise<{ artifacts: Array<{ content: string }>; message: string }>((res) => {
        pending.set(payload.generationId, res);
      });
    });

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
    });

    // First generation: complete it
    const firstPromise = useCodesignStore.getState().sendPrompt({ prompt: 'first' });
    const firstId = useCodesignStore.getState().activeGenerationId;
    if (!firstId) throw new Error('expected first generation id');
    await vi.waitFor(() => expect(pending.has(firstId)).toBe(true));
    pending.get(firstId)?.({ artifacts: [{ content: '<html></html>' }], message: 'ok' });
    await firstPromise;
    expect(useCodesignStore.getState().generationStage).toBe('done');

    // Second generation: capture stage transitions via subscription
    const captured: string[] = [];
    const unsub = useCodesignStore.subscribe((s) => {
      const st = s.generationStage;
      const last = captured[captured.length - 1];
      if (st !== last) captured.push(st);
    });

    const secondPromise = useCodesignStore.getState().sendPrompt({ prompt: 'second' });
    // 'sending' must be the first stage seen after subscribing
    expect(captured[0]).toBe('sending');

    const secondId = useCodesignStore.getState().activeGenerationId;
    if (!secondId) throw new Error('expected second generation id');
    await vi.waitFor(() => expect(pending.has(secondId)).toBe(true));
    pending.get(secondId)?.({ artifacts: [{ content: '<html></html>' }], message: 'ok' });
    await secondPromise;
    unsub();

    expect(useCodesignStore.getState().generationStage).toBe('done');
  });
});
