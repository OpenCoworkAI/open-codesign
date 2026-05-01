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
};

const initialState = useCodesignStore.getState();
const DEFAULT_DESIGN = {
  schemaVersion: 1 as const,
  id: 'design-1',
  name: 'Test design',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  thumbnailText: null,
  deletedAt: null,
  workspacePath: '/tmp/open-codesign-stage-test',
};

function mockChatApi() {
  return {
    seedFromSnapshots: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    append: vi.fn(async (input: { designId: string; kind: string; payload: unknown }) => ({
      id: `${input.kind}-1`,
      designId: input.designId,
      kind: input.kind,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      seq: 1,
    })),
  };
}

function mockSnapshotsApi() {
  return {
    list: vi.fn(async () => []),
    listDesigns: vi.fn(async () => useCodesignStore.getState().designs),
    setThumbnail: vi.fn(async (id: string, thumbnailText: string | null) => ({
      ...DEFAULT_DESIGN,
      id,
      thumbnailText,
    })),
    create: vi.fn(async (input: { designId: string; artifactSource: string }) => ({
      schemaVersion: 1 as const,
      id: `snapshot-${input.designId}`,
      designId: input.designId,
      parentId: null,
      type: 'initial' as const,
      prompt: null,
      artifactType: 'html' as const,
      artifactSource: input.artifactSource,
      createdAt: new Date().toISOString(),
      message: null,
    })),
  };
}

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
    designs: [DEFAULT_DESIGN],
    designsLoaded: true,
    currentDesignId: DEFAULT_DESIGN.id,
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
      codesign: { generate, chat: mockChatApi(), snapshots: mockSnapshotsApi() },
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
      codesign: { generate, chat: mockChatApi() },
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
      codesign: { generate, chat: mockChatApi(), snapshots: mockSnapshotsApi() },
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

  it('does not append artifact_delivered when generate returns assistant text only', async () => {
    useCodesignStore.setState({
      currentDesignId: 'design-1',
      previewHtml: '<html><body>existing</body></html>',
    });

    const append = vi.fn(async (input: { designId: string; kind: string; payload: unknown }) => ({
      id: `${input.kind}-1`,
      designId: input.designId,
      kind: input.kind,
      payload: input.payload,
      createdAt: new Date().toISOString(),
      seq: 1,
    }));
    const generate = vi.fn(async () => ({
      artifacts: [],
      message: '我是 gpt-5.4。',
    }));

    vi.stubGlobal('window', {
      codesign: {
        generate,
        chat: {
          seedFromSnapshots: vi.fn(async () => {}),
          list: vi.fn(async () => []),
          append,
        },
      },
      setTimeout,
    });

    await useCodesignStore.getState().sendPrompt({ prompt: '你是什么模型' });

    const kinds = append.mock.calls.map(([input]) => (input as { kind: string }).kind);
    expect(kinds).toContain('user');
    expect(kinds).toContain('assistant_text');
    expect(kinds).not.toContain('artifact_delivered');
    expect(useCodesignStore.getState().previewHtml).toBe('<html><body>existing</body></html>');
    expect(useCodesignStore.getState().generationStage).toBe('done');
  });
});
