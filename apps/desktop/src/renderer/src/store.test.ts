import { initI18n } from '@open-codesign/i18n';
import type { LocalInputFile, OnboardingState, SelectedElement } from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationStage } from './store';
import { useCodesignStore } from './store';

const READY_CONFIG: OnboardingState = {
  hasKey: true,
  provider: 'anthropic',
  modelPrimary: 'claude-sonnet-4-6',
  modelFast: 'claude-haiku-3',
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
      modelFast: 'gpt-4o-mini',
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
