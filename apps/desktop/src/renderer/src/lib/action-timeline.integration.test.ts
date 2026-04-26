import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { resetTimeline, snapshotTimeline } from './action-timeline';

describe('action timeline wiring', () => {
  beforeEach(() => {
    resetTimeline();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records prompt.submit when sendPrompt is invoked', async () => {
    vi.stubGlobal('window', {
      codesign: {
        generate: vi.fn(() => new Promise(() => {})),
      },
    });

    void useCodesignStore.getState().sendPrompt({ prompt: 'hello world' });

    const entries = snapshotTimeline();
    const submit = entries.find((e) => e.type === 'prompt.submit');
    expect(submit).toBeDefined();
    expect(submit?.data).toMatchObject({ promptLen: 11, hasAttachments: false });
  });

  it('records prompt.cancel when cancelGeneration is invoked', () => {
    useCodesignStore.getState().cancelGeneration();
    const entries = snapshotTimeline();
    expect(entries.some((e) => e.type === 'prompt.cancel')).toBe(true);
  });

  it('records onboarding.complete when completeOnboarding is invoked', () => {
    useCodesignStore.getState().completeOnboarding({
      hasKey: true,
      provider: 'anthropic',
      modelPrimary: 'claude-sonnet-4-6',
      modelFast: null,
      baseUrl: null,
      designSystem: null,
    });
    const entries = snapshotTimeline();
    expect(entries.some((e) => e.type === 'onboarding.complete')).toBe(true);
  });
});
