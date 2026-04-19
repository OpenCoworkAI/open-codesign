import { initI18n } from '@open-codesign/i18n';
import type { LocalInputFile, OnboardingState, SelectedElement } from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationStage } from './store';
import { accumulateWeekUsage, coerceUsageSnapshot, isoWeekKey, useCodesignStore } from './store';

const READY_CONFIG: OnboardingState = {
  hasKey: true,
  provider: 'anthropic',
  modelPrimary: 'claude-sonnet-4-6',
  baseUrl: null,
  designSystem: null,
};

const initialState = useCodesignStore.getState();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetStore() {
  useCodesignStore.setState({
    ...initialState,
    messages: [],
    previewHtml: null,
    isGenerating: false,
    activeGenerationId: null,
    errorMessage: null,
    lastError: null,
    config: READY_CONFIG,
    configLoaded: true,
    toastMessage: null,
    iframeErrors: [],
    toasts: [],
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCodesignStore iframe error handling', () => {
  it('clears stale iframe errors when starting a new generation', async () => {
    let resolveGenerate: ((value: unknown) => void) | undefined;
    const generate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGenerate = resolve;
        }),
    );

    vi.stubGlobal('window', {
      codesign: {
        generate,
      },
    });

    useCodesignStore.setState({ iframeErrors: ['old iframe error'] });

    const sendPromise = useCodesignStore.getState().sendPrompt({ prompt: 'make a landing page' });

    expect(useCodesignStore.getState().iframeErrors).toEqual([]);
    expect(useCodesignStore.getState().isGenerating).toBe(true);

    resolveGenerate?.({
      artifacts: [{ content: '<html></html>' }],
      message: 'Done.',
    });
    await sendPromise;

    expect(generate).toHaveBeenCalledOnce();
  });

  it('deduplicates consecutive identical iframe errors', () => {
    const { pushIframeError } = useCodesignStore.getState();

    pushIframeError('first');
    pushIframeError('first'); // duplicate — should be skipped
    pushIframeError('second');
    pushIframeError('second'); // duplicate — should be skipped
    pushIframeError('third');

    expect(useCodesignStore.getState().iframeErrors).toEqual(['first', 'second', 'third']);
  });

  it('caps iframeErrors at 50 entries and drops the oldest when exceeded', () => {
    const { pushIframeError } = useCodesignStore.getState();

    for (let i = 0; i < 55; i++) {
      pushIframeError(`error-${i}`);
    }

    const errors = useCodesignStore.getState().iframeErrors;
    expect(errors).toHaveLength(50);
    // oldest (0-4) should have been shifted out; newest (5-54) remain
    expect(errors[0]).toBe('error-5');
    expect(errors[49]).toBe('error-54');
  });
});

describe('useCodesignStore generation cancellation', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('ignores stale completions from a cancelled generation after a resubmit', async () => {
    const pendingById = new Map<
      string,
      ReturnType<typeof deferred<{ artifacts: Array<{ content: string }>; message: string }>>
    >();
    const cancelGeneration = vi.fn(() => Promise.resolve());
    const generate = vi.fn((payload: { generationId?: string }) => {
      if (!payload.generationId) throw new Error('missing generationId');
      const task = deferred<{ artifacts: Array<{ content: string }>; message: string }>();
      pendingById.set(payload.generationId, task);
      return task.promise;
    });

    vi.stubGlobal('window', {
      codesign: {
        generate,
        cancelGeneration,
      },
      setTimeout,
    });

    const firstRun = useCodesignStore.getState().sendPrompt({ prompt: 'first prompt' });
    const firstId = useCodesignStore.getState().activeGenerationId;
    if (!firstId) throw new Error('expected first generation id');

    useCodesignStore.getState().cancelGeneration();

    // Drain microtasks so the cancel IPC promise resolves and clears state
    await Promise.resolve();

    const secondRun = useCodesignStore.getState().sendPrompt({ prompt: 'second prompt' });
    const secondId = useCodesignStore.getState().activeGenerationId;
    if (!secondId) throw new Error('expected second generation id');
    expect(secondId).not.toBe(firstId);

    pendingById.get(firstId)?.resolve({
      artifacts: [{ content: '<html>old</html>' }],
      message: 'Old result',
    });
    await firstRun;

    expect(useCodesignStore.getState().activeGenerationId).toBe(secondId);
    expect(useCodesignStore.getState().isGenerating).toBe(true);
    expect(useCodesignStore.getState().previewHtml).toBeNull();
    expect(useCodesignStore.getState().messages.some((m) => m.content === 'Old result')).toBe(
      false,
    );

    pendingById.get(secondId)?.resolve({
      artifacts: [{ content: '<html>fresh</html>' }],
      message: 'Fresh result',
    });
    await secondRun;

    expect(cancelGeneration).toHaveBeenCalledWith(firstId);
    expect(useCodesignStore.getState().previewHtml).toBe('<html>fresh</html>');
    expect(useCodesignStore.getState().isGenerating).toBe(false);
  });

  it('sets errorMessage and pushes a toast when window.codesign is missing during cancel', () => {
    vi.stubGlobal('window', { setTimeout });

    useCodesignStore.setState({ activeGenerationId: 'gen-123' });

    useCodesignStore.getState().cancelGeneration();

    const state = useCodesignStore.getState();
    expect(state.errorMessage).toBeTruthy();
    expect(state.lastError).toBe(state.errorMessage);
    expect(state.toasts.at(-1)).toMatchObject({
      variant: 'error',
    });
  });

  it('surfaces current-generation failures even when the message contains abort wording', async () => {
    const pendingById = new Map<
      string,
      ReturnType<typeof deferred<{ artifacts: Array<{ content: string }>; message: string }>>
    >();
    const generate = vi.fn((payload: { generationId?: string }) => {
      if (!payload.generationId) throw new Error('missing generationId');
      const task = deferred<{ artifacts: Array<{ content: string }>; message: string }>();
      pendingById.set(payload.generationId, task);
      return task.promise;
    });

    vi.stubGlobal('window', {
      codesign: {
        generate,
        cancelGeneration: vi.fn(() => Promise.resolve()),
      },
      setTimeout,
    });

    const run = useCodesignStore.getState().sendPrompt({ prompt: 'first prompt' });
    const generationId = useCodesignStore.getState().activeGenerationId;
    if (!generationId) throw new Error('expected generation id');

    pendingById.get(generationId)?.reject(new Error('Upstream proxy aborted the response'));
    await run;

    const state = useCodesignStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.activeGenerationId).toBeNull();
    expect(state.errorMessage).toBe('Upstream proxy aborted the response');
    expect(state.lastError).toBe('Upstream proxy aborted the response');
    expect(state.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'Error: Upstream proxy aborted the response',
    });
    expect(state.toasts.at(-1)).toMatchObject({
      variant: 'error',
      description: 'Upstream proxy aborted the response',
    });
  });
});

describe('useCodesignStore view navigation', () => {
  it('starts on hub view', () => {
    expect(useCodesignStore.getState().view).toBe('hub');
  });

  it('setView("settings") switches to settings and closes command palette', () => {
    useCodesignStore.setState({ commandPaletteOpen: true });
    useCodesignStore.getState().setView('settings');
    expect(useCodesignStore.getState().view).toBe('settings');
    expect(useCodesignStore.getState().commandPaletteOpen).toBe(false);
  });

  it('setView("workspace") switches back from settings', () => {
    useCodesignStore.getState().setView('settings');
    useCodesignStore.getState().setView('workspace');
    expect(useCodesignStore.getState().view).toBe('workspace');
  });
});

describe('useCodesignStore token usage tracking', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('records lastUsage and accumulates weekUsage when generate resolves with usage fields', async () => {
    const generate = vi.fn(() =>
      Promise.resolve({
        artifacts: [{ content: '<html>ok</html>' }],
        message: 'Done.',
        inputTokens: 1200,
        outputTokens: 800,
        costUsd: 0.0125,
      }),
    );

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
      localStorage: {
        getItem: () => null,
        setItem: () => {
          /* noop */
        },
      },
    });

    useCodesignStore.setState({
      weekUsage: { isoWeek: '2099-W01', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      lastUsage: null,
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'design landing' });

    const state = useCodesignStore.getState();
    expect(state.lastUsage).toEqual({ inputTokens: 1200, outputTokens: 800, costUsd: 0.0125 });
    expect(state.weekUsage.inputTokens).toBe(1200);
    expect(state.weekUsage.outputTokens).toBe(800);
    expect(state.weekUsage.costUsd).toBeCloseTo(0.0125, 6);
    expect(state.streamingTokenCount).toBe(2000);
  });

  it('treats missing usage fields as zero without crashing', async () => {
    const generate = vi.fn(() =>
      Promise.resolve({
        artifacts: [{ content: '<html>ok</html>' }],
        message: 'Done.',
      }),
    );

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
      localStorage: { getItem: () => null, setItem: () => undefined },
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'fallback' });

    const state = useCodesignStore.getState();
    expect(state.lastUsage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });

  it('surfaces a toast and preserves in-memory weekUsage when localStorage write throws', async () => {
    const generate = vi.fn(() =>
      Promise.resolve({
        artifacts: [{ content: '<html>ok</html>' }],
        message: 'Done.',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      }),
    );

    const setItem = vi.fn(() => {
      throw new Error('QuotaExceeded');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.stubGlobal('window', {
      codesign: { generate },
      setTimeout,
      localStorage: { getItem: () => null, setItem },
    });

    useCodesignStore.setState({
      weekUsage: {
        isoWeek: isoWeekKey(new Date()),
        inputTokens: 7,
        outputTokens: 3,
        costUsd: 0.02,
      },
      lastUsage: null,
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'persist failure' });

    const state = useCodesignStore.getState();
    expect(setItem).toHaveBeenCalled();
    expect(state.weekUsage.inputTokens).toBe(107);
    expect(state.weekUsage.outputTokens).toBe(53);
    expect(state.weekUsage.costUsd).toBeCloseTo(0.03, 6);
    expect(state.lastUsage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    expect(state.toasts.at(-1)).toMatchObject({
      variant: 'error',
      description: 'QuotaExceeded',
    });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('accumulateWeekUsage', () => {
  it('adds delta to current bucket when isoWeek matches', () => {
    const prev = { isoWeek: '2026-W16', inputTokens: 100, outputTokens: 50, costUsd: 0.5 };
    const next = accumulateWeekUsage(
      prev,
      { inputTokens: 30, outputTokens: 20, costUsd: 0.25 },
      new Date('2026-04-19T12:00:00Z'),
    );
    expect(next.isoWeek).toBe('2026-W16');
    expect(next.inputTokens).toBe(130);
    expect(next.outputTokens).toBe(70);
    expect(next.costUsd).toBeCloseTo(0.75, 6);
  });

  it('resets bucket when the ISO week has rolled over', () => {
    const prev = { isoWeek: '2025-W01', inputTokens: 999, outputTokens: 999, costUsd: 9 };
    const next = accumulateWeekUsage(
      prev,
      { inputTokens: 5, outputTokens: 7, costUsd: 0.01 },
      new Date('2026-04-19T12:00:00Z'),
    );
    expect(next.isoWeek).not.toBe('2025-W01');
    expect(next.inputTokens).toBe(5);
    expect(next.outputTokens).toBe(7);
    expect(next.costUsd).toBeCloseTo(0.01, 6);
  });

  it('clamps negative deltas to zero', () => {
    const prev = { isoWeek: isoWeekKey(new Date()), inputTokens: 10, outputTokens: 10, costUsd: 1 };
    const next = accumulateWeekUsage(
      prev,
      { inputTokens: -5, outputTokens: -3, costUsd: -0.5 },
      new Date(),
    );
    expect(next.inputTokens).toBe(10);
    expect(next.outputTokens).toBe(10);
    expect(next.costUsd).toBe(1);
  });
});

describe('coerceUsageSnapshot', () => {
  it('rejects NaN inputs and reports the field', () => {
    const { usage, rejected } = coerceUsageSnapshot({
      inputTokens: Number.NaN,
      outputTokens: 200,
      costUsd: 0.01,
    });
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(200);
    expect(usage.costUsd).toBe(0.01);
    expect(rejected).toEqual(['inputTokens']);
  });

  it('rejects Infinity inputs and reports the field', () => {
    const { usage, rejected } = coerceUsageSnapshot({
      inputTokens: 100,
      outputTokens: Number.POSITIVE_INFINITY,
      costUsd: Number.NEGATIVE_INFINITY,
    });
    expect(usage.outputTokens).toBe(0);
    expect(usage.costUsd).toBe(0);
    expect(rejected).toEqual(['outputTokens', 'costUsd']);
  });

  it('accepts finite zero without rejecting', () => {
    const { usage, rejected } = coerceUsageSnapshot({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(rejected).toEqual([]);
  });
});

// Simulate the escape handler logic from App.tsx to verify priority:
//   commandPaletteOpen → close palette (view unchanged)
//   palette closed + view=settings → go to workspace
function pressEscape(
  view: ReturnType<typeof useCodesignStore.getState>['view'],
  commandPaletteOpen: boolean,
): void {
  const store = useCodesignStore.getState();
  if (commandPaletteOpen) {
    store.closeCommandPalette();
    return;
  }
  if (view === 'settings') {
    store.setView('workspace');
  }
}

describe('ESC key priority: command palette > settings view', () => {
  it('ESC closes command palette without leaving settings when both are open', () => {
    useCodesignStore.setState({ view: 'settings', commandPaletteOpen: true });
    pressEscape('settings', true);

    const s = useCodesignStore.getState();
    expect(s.commandPaletteOpen).toBe(false);
    // view must stay on settings — the palette consumed the keypress
    expect(s.view).toBe('settings');
  });

  it('ESC navigates back to workspace when palette is closed and view is settings', () => {
    useCodesignStore.setState({ view: 'settings', commandPaletteOpen: false });
    pressEscape('settings', false);

    const s = useCodesignStore.getState();
    expect(s.view).toBe('workspace');
    expect(s.commandPaletteOpen).toBe(false);
  });

  it('ESC is a no-op when palette is closed and view is workspace', () => {
    useCodesignStore.setState({ view: 'workspace', commandPaletteOpen: false });
    pressEscape('workspace', false);

    const s = useCodesignStore.getState();
    expect(s.view).toBe('workspace');
    expect(s.commandPaletteOpen).toBe(false);
  });
});

describe('useCodesignStore active provider routing', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('sendPrompt uses the active provider from config after setActiveProvider updates config', async () => {
    const generate = vi.fn(() =>
      Promise.resolve({ artifacts: [{ content: '<html></html>' }], message: 'Done.' }),
    );

    vi.stubGlobal('window', { codesign: { generate }, setTimeout });

    const openaiConfig: OnboardingState = {
      hasKey: true,
      provider: 'openai',
      modelPrimary: 'gpt-4o',
      baseUrl: null,
      designSystem: null,
    };

    // Simulate setActiveProvider result updating the store config.
    useCodesignStore.getState().completeOnboarding(openaiConfig);

    await useCodesignStore.getState().sendPrompt({ prompt: 'make a button' });

    expect(generate).toHaveBeenCalledOnce();
    const call = generate.mock.calls[0] as unknown as [
      { model: { provider: string; modelId: string } },
    ];
    const payload = call[0];
    expect(payload.model.provider).toBe('openai');
    expect(payload.model.modelId).toBe('gpt-4o');
  });
});

describe('useCodesignStore project storage error surfacing', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('createProject pushes a toast when localStorage.setItem throws and keeps the project in memory', () => {
    const setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.fn(() => null);

    vi.stubGlobal('window', {
      localStorage: { setItem, getItem, removeItem: vi.fn(), clear: vi.fn() },
      setTimeout,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const projectsBefore = useCodesignStore.getState().projects;
    const toastsBefore = useCodesignStore.getState().toasts.length;

    const project = useCodesignStore
      .getState()
      .createProject({ name: 'My Project', type: 'slideDeck' });

    const state = useCodesignStore.getState();

    // In-memory state stays consistent — the project was added even though persist failed.
    expect(state.projects[0]).toEqual(project);
    expect(state.projects).toHaveLength(projectsBefore.length + 1);
    expect(state.currentProjectId).toBe(project.id);

    // Toast surfaced with the i18n title and the underlying error message.
    expect(state.toasts.length).toBe(toastsBefore + 1);
    expect(state.toasts.at(-1)).toMatchObject({
      variant: 'error',
      description: 'QuotaExceededError',
    });
    expect(state.toasts.at(-1)?.title).toBeTruthy();

    expect(setItem).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('createProject resets project-scoped workspace state when switching to the new project', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: vi.fn(),
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      setTimeout,
    });

    const staleFile: LocalInputFile = {
      path: '/tmp/old.png',
      name: 'old.png',
      size: 1,
    };
    const staleSelection: SelectedElement = {
      selector: '.stale',
      tag: 'div',
      outerHTML: '<div class="stale">old</div>',
      rect: { top: 0, left: 0, width: 10, height: 10 },
    };

    useCodesignStore.setState({
      messages: [{ role: 'user', content: 'old prompt' }],
      previewHtml: '<html>old</html>',
      inputFiles: [staleFile],
      referenceUrl: 'https://example.com/old',
      selectedElement: staleSelection,
      lastPromptInput: { prompt: 'old prompt', attachments: [staleFile] },
      isGenerating: true,
      activeGenerationId: 'gen-old',
      errorMessage: 'stale error',
      lastError: 'stale error',
      generationStage: 'streaming' as GenerationStage,
    });

    const project = useCodesignStore
      .getState()
      .createProject({ name: 'Fresh Project', type: 'prototype' });

    const state = useCodesignStore.getState();
    expect(state.currentProjectId).toBe(project.id);
    expect(state.view).toBe('workspace');
    expect(state.createProjectModalOpen).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.previewHtml).toBeNull();
    expect(state.inputFiles).toEqual([]);
    expect(state.referenceUrl).toBe('');
    expect(state.selectedElement).toBeNull();
    expect(state.lastPromptInput).toBeNull();
    expect(state.isGenerating).toBe(false);
    expect(state.activeGenerationId).toBeNull();
    expect(state.errorMessage).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.generationStage).toBe('idle');
  });
});

describe('useCodesignStore previewViewport', () => {
  it('defaults to desktop', () => {
    expect(useCodesignStore.getState().previewViewport).toBe('desktop');
  });

  it('switches to tablet via setPreviewViewport', () => {
    useCodesignStore.getState().setPreviewViewport('tablet');
    expect(useCodesignStore.getState().previewViewport).toBe('tablet');
  });

  it('switches to mobile via setPreviewViewport', () => {
    useCodesignStore.getState().setPreviewViewport('mobile');
    expect(useCodesignStore.getState().previewViewport).toBe('mobile');
  });

  it('switches back to desktop via setPreviewViewport', () => {
    useCodesignStore.getState().setPreviewViewport('mobile');
    useCodesignStore.getState().setPreviewViewport('desktop');
    expect(useCodesignStore.getState().previewViewport).toBe('desktop');
  });
});

// ---------------------------------------------------------------------------
// Project (design) management
// ---------------------------------------------------------------------------

describe('useCodesignStore design management', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('switches the message list when switchDesign is called and isolates state per design', async () => {
    const designs = [
      {
        schemaVersion: 1 as const,
        id: 'design-a',
        name: 'A',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
      },
      {
        schemaVersion: 1 as const,
        id: 'design-b',
        name: 'B',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
      },
    ];

    const messagesByDesign: Record<string, Array<{ role: string; content: string }>> = {
      'design-a': [
        { role: 'user', content: 'A user' },
        { role: 'assistant', content: 'A reply' },
      ],
      'design-b': [{ role: 'user', content: 'B user' }],
    };

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          listDesigns: vi.fn(() => Promise.resolve(designs)),
          listMessages: vi.fn((id: string) => Promise.resolve(messagesByDesign[id] ?? [])),
          list: vi.fn(() => Promise.resolve([])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({ currentDesignId: 'design-a' });
    await useCodesignStore.getState().switchDesign('design-b');

    expect(useCodesignStore.getState().currentDesignId).toBe('design-b');
    expect(useCodesignStore.getState().messages.map((m) => m.content)).toEqual(['B user']);

    await useCodesignStore.getState().switchDesign('design-a');
    expect(useCodesignStore.getState().messages.map((m) => m.content)).toEqual([
      'A user',
      'A reply',
    ]);
  });

  it('createNewDesign resets messages + preview and stores the new id as current', async () => {
    const created = {
      schemaVersion: 1 as const,
      id: 'fresh',
      name: 'Untitled design 1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      thumbnailText: null,
      deletedAt: null,
    };

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          createDesign: vi.fn(() => Promise.resolve(created)),
          listDesigns: vi.fn(() => Promise.resolve([created])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({
      messages: [{ role: 'user', content: 'leftover' }],
      previewHtml: '<html>old</html>',
      currentDesignId: 'old-id',
    });

    const result = await useCodesignStore.getState().createNewDesign();
    expect(result?.id).toBe('fresh');
    const state = useCodesignStore.getState();
    expect(state.currentDesignId).toBe('fresh');
    expect(state.messages).toEqual([]);
    expect(state.previewHtml).toBeNull();
  });

  it('blocks switchDesign while a generation is running', async () => {
    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          listMessages: vi.fn(() => Promise.resolve([])),
          list: vi.fn(() => Promise.resolve([])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({
      currentDesignId: 'design-a',
      isGenerating: true,
    });

    await useCodesignStore.getState().switchDesign('design-b');

    // Should not have switched.
    expect(useCodesignStore.getState().currentDesignId).toBe('design-a');
    // Should have surfaced a toast about the block.
    expect(useCodesignStore.getState().toasts.at(-1)?.variant).toBe('info');
  });

  it('blocks softDeleteDesign while a generation is running so applyGenerateSuccess cannot leak into a stale design', async () => {
    const softDeleteDesign = vi.fn(() => Promise.resolve());
    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          softDeleteDesign,
          listDesigns: vi.fn(() => Promise.resolve([])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({
      currentDesignId: 'design-a',
      isGenerating: true,
    });

    await useCodesignStore.getState().softDeleteDesign('design-a');

    expect(softDeleteDesign).not.toHaveBeenCalled();
    expect(useCodesignStore.getState().currentDesignId).toBe('design-a');
    expect(useCodesignStore.getState().toasts.at(-1)?.variant).toBe('info');
  });
});

describe('useCodesignStore previewZoom', () => {
  it('defaults previewZoom to 100', () => {
    expect(useCodesignStore.getState().previewZoom).toBe(100);
  });

  it('updates previewZoom via setPreviewZoom', () => {
    useCodesignStore.getState().setPreviewZoom(150);
    expect(useCodesignStore.getState().previewZoom).toBe(150);
  });
});
describe('useCodesignStore artifact persistence', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('writes a design_snapshots row after generate.ok and rehydrates the preview on switchDesign', async () => {
    const designId = 'design-persist';
    const designRow = {
      schemaVersion: 1 as const,
      id: designId,
      name: 'Untitled design 1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      thumbnailText: null,
      deletedAt: null,
    };

    // Stand-in for the SQLite-backed snapshots table.
    type SnapshotRow = {
      schemaVersion: 1;
      id: string;
      designId: string;
      parentId: string | null;
      type: 'initial' | 'edit' | 'fork';
      prompt: string | null;
      artifactType: 'html' | 'react' | 'svg';
      artifactSource: string;
      createdAt: string;
      message?: string;
    };
    const snapshotsByDesign = new Map<string, SnapshotRow[]>();
    let nextSnapshotId = 1;

    const generate = vi.fn(() =>
      Promise.resolve({
        artifacts: [{ type: 'html', content: '<html><body>persisted</body></html>' }],
        message: 'Generated.',
      }),
    );
    const replaceMessages = vi.fn(() => Promise.resolve([]));
    const setThumbnail = vi.fn(() => Promise.resolve(designRow));
    const renameDesign = vi.fn(() => Promise.resolve(designRow));
    const listDesigns = vi.fn(() => Promise.resolve([designRow]));
    const list = vi.fn((id: string) =>
      Promise.resolve([...(snapshotsByDesign.get(id) ?? [])].reverse()),
    );
    const create = vi.fn((input: Omit<SnapshotRow, 'id' | 'createdAt' | 'schemaVersion'>) => {
      const row: SnapshotRow = {
        schemaVersion: 1,
        id: `snap-${nextSnapshotId++}`,
        createdAt: new Date().toISOString(),
        ...input,
      };
      const bucket = snapshotsByDesign.get(input.designId) ?? [];
      bucket.push(row);
      snapshotsByDesign.set(input.designId, bucket);
      return Promise.resolve(row);
    });
    const listMessages = vi.fn(() =>
      Promise.resolve([
        {
          schemaVersion: 1 as const,
          designId,
          ordinal: 0,
          role: 'user' as const,
          content: 'make a hero section',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          schemaVersion: 1 as const,
          designId,
          ordinal: 1,
          role: 'assistant' as const,
          content: 'Generated.',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]),
    );

    vi.stubGlobal('window', {
      codesign: {
        generate,
        snapshots: {
          listDesigns,
          list,
          create,
          replaceMessages,
          setThumbnail,
          renameDesign,
          listMessages,
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({ currentDesignId: designId, designs: [designRow] });

    await useCodesignStore.getState().sendPrompt({ prompt: 'make a hero section' });
    // persistDesignState fires-and-forgets; drain microtasks until create resolves.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(create).toHaveBeenCalledOnce();
    const createArg = create.mock.calls[0]?.[0];
    expect(createArg).toMatchObject({
      designId,
      parentId: null,
      type: 'initial',
      artifactType: 'html',
      artifactSource: '<html><body>persisted</body></html>',
      prompt: 'make a hero section',
    });
    expect(snapshotsByDesign.get(designId)).toHaveLength(1);

    // Simulate a fresh app load: blow away in-memory state then switchDesign.
    useCodesignStore.setState({
      currentDesignId: null,
      messages: [],
      previewHtml: null,
    });

    await useCodesignStore.getState().switchDesign(designId);

    const restored = useCodesignStore.getState();
    expect(restored.currentDesignId).toBe(designId);
    expect(restored.previewHtml).toBe('<html><body>persisted</body></html>');
    expect(restored.messages).toEqual([
      { role: 'user', content: 'make a hero section' },
      { role: 'assistant', content: 'Generated.' },
    ]);
  });
});

describe('loadDesigns startup', () => {
  it('populates designs from listDesigns IPC so persisted work reappears after relaunch', async () => {
    const designs = [
      {
        schemaVersion: 1 as const,
        id: 'design-1',
        name: 'Persisted A',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
      },
      {
        schemaVersion: 1 as const,
        id: 'design-2',
        name: 'Persisted B',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        thumbnailText: null,
        deletedAt: null,
      },
    ];

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          listDesigns: vi.fn(() => Promise.resolve(designs)),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({ designs: [], designsLoaded: false });
    await useCodesignStore.getState().loadDesigns();

    const state = useCodesignStore.getState();
    expect(state.designs).toHaveLength(2);
    expect(state.designs.map((d) => d.id)).toEqual(['design-1', 'design-2']);
    expect(state.designsLoaded).toBe(true);
  });
});

describe('useCodesignStore interaction mode', () => {
  it('defaults to "default" mode with no selected element', () => {
    const state = useCodesignStore.getState();
    expect(state.interactionMode).toBe('default');
    expect(state.selectedElement).toBeNull();
  });

  it('setInteractionMode("comment") enters comment mode without touching selectedElement', () => {
    useCodesignStore.getState().setInteractionMode('comment');
    expect(useCodesignStore.getState().interactionMode).toBe('comment');
    expect(useCodesignStore.getState().selectedElement).toBeNull();
  });

  it('setInteractionMode("default") clears selectedElement when leaving comment mode', () => {
    const selection: SelectedElement = {
      selector: '.btn',
      tag: 'button',
      outerHTML: '<button class="btn">x</button>',
      rect: { top: 0, left: 0, width: 10, height: 10 },
    };
    useCodesignStore.setState({ interactionMode: 'comment', selectedElement: selection });

    useCodesignStore.getState().setInteractionMode('default');

    const s = useCodesignStore.getState();
    expect(s.interactionMode).toBe('default');
    expect(s.selectedElement).toBeNull();
  });
});
