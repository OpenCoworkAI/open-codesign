import { initI18n } from '@open-codesign/i18n';
import type { OnboardingState, SelectedElement } from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coerceUsageSnapshot,
  extractCodesignErrorCode,
  extractUpstreamContext,
  useCodesignStore,
} from './store';

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

    // sendPrompt awaits buildHistoryFromChat before invoking generate — flush
    // that microtask so the mock is called and resolveGenerate captured.
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());

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

    await vi.waitFor(() => expect(pendingById.has(generationId)).toBe(true));

    pendingById.get(generationId)?.reject(new Error('Upstream proxy aborted the response'));
    await run;

    const state = useCodesignStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.activeGenerationId).toBeNull();
    expect(state.errorMessage).toBe('Upstream proxy aborted the response');
    expect(state.lastError).toBe('Upstream proxy aborted the response');
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

  it('setView("settings") switches to settings', () => {
    useCodesignStore.getState().setView('settings');
    expect(useCodesignStore.getState().view).toBe('settings');
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

  it('records lastUsage when generate resolves with usage fields', async () => {
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
    });

    useCodesignStore.setState({ lastUsage: null });

    await useCodesignStore.getState().sendPrompt({ prompt: 'design landing' });

    const state = useCodesignStore.getState();
    expect(state.lastUsage).toEqual({ inputTokens: 1200, outputTokens: 800, costUsd: 0.0125 });
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
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'fallback' });

    const state = useCodesignStore.getState();
    expect(state.lastUsage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
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

// Simulate the escape handler logic from App.tsx: in settings view, ESC goes
// back to previousView; in workspace, ESC is no longer a view-jump (only
// closes local overlays, none of which are exercised here).
function pressEscape(view: ReturnType<typeof useCodesignStore.getState>['view']): void {
  const store = useCodesignStore.getState();
  if (view === 'settings') {
    const prev = store.previousView;
    store.setView(prev === 'settings' ? 'hub' : prev);
  }
}

describe('ESC key: settings view returns to previousView', () => {
  it('ESC from settings (entered from workspace) returns to workspace', () => {
    useCodesignStore.setState({ view: 'workspace', previousView: 'hub' });
    useCodesignStore.getState().setView('settings');
    pressEscape('settings');

    expect(useCodesignStore.getState().view).toBe('workspace');
  });

  it('ESC from settings (entered from hub) returns to hub', () => {
    useCodesignStore.setState({ view: 'hub', previousView: 'hub' });
    useCodesignStore.getState().setView('settings');
    pressEscape('settings');

    expect(useCodesignStore.getState().view).toBe('hub');
  });

  it('ESC is a no-op when view is workspace', () => {
    useCodesignStore.setState({ view: 'workspace', previousView: 'hub' });
    pressEscape('workspace');

    expect(useCodesignStore.getState().view).toBe('workspace');
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
// Design management
// ---------------------------------------------------------------------------

describe('useCodesignStore design management', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('isolates preview + currentDesignId per design when switchDesign is called', async () => {
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

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          listDesigns: vi.fn(() => Promise.resolve(designs)),
          list: vi.fn(() => Promise.resolve([])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({ currentDesignId: 'design-a' });
    await useCodesignStore.getState().switchDesign('design-b');

    expect(useCodesignStore.getState().currentDesignId).toBe('design-b');

    await useCodesignStore.getState().switchDesign('design-a');
    expect(useCodesignStore.getState().currentDesignId).toBe('design-a');
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
      previewHtml: '<html>old</html>',
      currentDesignId: 'old-id',
    });

    const result = await useCodesignStore.getState().createNewDesign();
    expect(result?.id).toBe('fresh');
    const state = useCodesignStore.getState();
    expect(state.currentDesignId).toBe('fresh');
    expect(state.previewHtml).toBeNull();
  });

  it('allows switchDesign while another design is generating (generation stays bound to its origin)', async () => {
    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          list: vi.fn(() => Promise.resolve([])),
        },
      },
      setTimeout,
    });

    useCodesignStore.setState({
      currentDesignId: 'design-a',
      isGenerating: true,
      generatingDesignId: 'design-a',
    });

    await useCodesignStore.getState().switchDesign('design-b');

    const state = useCodesignStore.getState();
    expect(state.currentDesignId).toBe('design-b');
    // Generation flag still set, but bound to the originating design.
    expect(state.isGenerating).toBe(true);
    expect(state.generatingDesignId).toBe('design-a');
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
      workspacePath: null,
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

    vi.stubGlobal('window', {
      codesign: {
        generate,
        snapshots: {
          listDesigns,
          list,
          create,
          setThumbnail,
          renameDesign,
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
      previewHtml: null,
    });

    await useCodesignStore.getState().switchDesign(designId);

    const restored = useCodesignStore.getState();
    expect(restored.currentDesignId).toBe(designId);
    expect(restored.previewHtml).toBe('<html><body>persisted</body></html>');
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

describe('useCodesignStore liveRects', () => {
  it('applyLiveRects merges entries by selector', () => {
    useCodesignStore.setState({ liveRects: {} });
    useCodesignStore.getState().applyLiveRects([
      { selector: '#a', rect: { top: 10, left: 20, width: 30, height: 40 } },
      { selector: '#b', rect: { top: 1, left: 2, width: 3, height: 4 } },
    ]);
    expect(useCodesignStore.getState().liveRects).toEqual({
      '#a': { top: 10, left: 20, width: 30, height: 40 },
      '#b': { top: 1, left: 2, width: 3, height: 4 },
    });

    useCodesignStore
      .getState()
      .applyLiveRects([{ selector: '#a', rect: { top: 99, left: 20, width: 30, height: 40 } }]);
    expect(useCodesignStore.getState().liveRects['#a']?.top).toBe(99);
    expect(useCodesignStore.getState().liveRects['#b']?.top).toBe(1);
  });

  it('clearLiveRects wipes the map (used on design switch)', () => {
    useCodesignStore.setState({
      liveRects: { '#a': { top: 1, left: 2, width: 3, height: 4 } },
    });
    useCodesignStore.getState().clearLiveRects();
    expect(useCodesignStore.getState().liveRects).toEqual({});
  });

  it('applyLiveRects is a no-op for empty entries (keeps reference stable)', () => {
    const map = { '#a': { top: 1, left: 2, width: 3, height: 4 } };
    useCodesignStore.setState({ liveRects: map });
    useCodesignStore.getState().applyLiveRects([]);
    expect(useCodesignStore.getState().liveRects).toBe(map);
  });
});

describe('useCodesignStore pushToast -> recordRendererError', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('pushToast for an error auto-creates a ReportableError and fires recordRendererError', async () => {
    const recordRendererError = vi.fn().mockResolvedValue({ eventId: 42 });
    vi.stubGlobal('window', {
      codesign: {
        diagnostics: { recordRendererError },
      },
    });

    useCodesignStore.setState({ reportableErrors: [] });
    useCodesignStore.getState().pushToast({
      variant: 'error',
      title: 'Boom',
      description: 'Something broke',
    });

    // Allow the fire-and-forget promise to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(recordRendererError).toHaveBeenCalledTimes(1);
    const payload = recordRendererError.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      schemaVersion: 1,
      code: 'RENDERER_ERROR',
      scope: 'renderer',
      message: 'Something broke',
    });
    expect(useCodesignStore.getState().reportableErrors).toHaveLength(1);
  });

  it('uses toast.title as the message when description is absent', async () => {
    const recordRendererError = vi.fn().mockResolvedValue({ eventId: null });
    vi.stubGlobal('window', {
      codesign: {
        diagnostics: { recordRendererError },
      },
    });

    useCodesignStore.setState({ reportableErrors: [] });
    useCodesignStore.getState().pushToast({
      variant: 'error',
      title: 'Plain failure',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(recordRendererError).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        code: 'RENDERER_ERROR',
        scope: 'renderer',
        message: 'Plain failure',
      }),
    );
  });

  it('does not call recordRendererError for non-error toasts', async () => {
    const recordRendererError = vi.fn();
    vi.stubGlobal('window', {
      codesign: {
        diagnostics: { recordRendererError },
      },
    });

    useCodesignStore.getState().pushToast({ variant: 'info', title: 'hello' });
    await Promise.resolve();
    expect(recordRendererError).not.toHaveBeenCalled();
  });
});

describe('useCodesignStore report dialog slice', () => {
  it('openReportDialog sets activeReportLocalId and closeReportDialog clears it', () => {
    useCodesignStore.setState({ activeReportLocalId: null });
    useCodesignStore.getState().openReportDialog('local-7');
    expect(useCodesignStore.getState().activeReportLocalId).toBe('local-7');
    useCodesignStore.getState().closeReportDialog();
    expect(useCodesignStore.getState().activeReportLocalId).toBeNull();
  });

  it('createReportableError caps the ring at MAX_REPORTABLE (100)', () => {
    vi.stubGlobal('window', { codesign: undefined });
    useCodesignStore.setState({ reportableErrors: [] });
    const state = useCodesignStore.getState();
    for (let i = 0; i < 105; i += 1) {
      state.createReportableError({
        code: 'X',
        scope: 'test',
        message: `msg-${i}`,
      });
    }
    expect(useCodesignStore.getState().reportableErrors).toHaveLength(100);
    expect(useCodesignStore.getState().reportableErrors[0]?.message).toBe('msg-5');
  });

  it('getReportableError returns the record by localId', () => {
    vi.stubGlobal('window', { codesign: undefined });
    useCodesignStore.setState({ reportableErrors: [] });
    const id = useCodesignStore.getState().createReportableError({
      code: 'IMPORT_FAILED',
      scope: 'onboarding',
      message: 'could not read opencode config',
    });
    const found = useCodesignStore.getState().getReportableError(id);
    expect(found?.code).toBe('IMPORT_FAILED');
    expect(found?.message).toBe('could not read opencode config');
    expect(found?.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('patches persistedEventId + persistedFingerprint after recordRendererError resolves', async () => {
    const recordRendererError = vi
      .fn()
      .mockResolvedValue({ schemaVersion: 1, eventId: 123, fingerprint: 'main-side-fp' });
    vi.stubGlobal('window', { codesign: { diagnostics: { recordRendererError } } });
    useCodesignStore.setState({ reportableErrors: [] });
    const id = useCodesignStore.getState().createReportableError({
      code: 'X',
      scope: 'y',
      message: 'boom',
    });
    await Promise.resolve();
    await Promise.resolve();
    const record = useCodesignStore.getState().getReportableError(id);
    expect(record?.persistedEventId).toBe(123);
    expect(record?.persistedFingerprint).toBe('main-side-fp');
  });

  it('omits persistedFingerprint when main does not echo one back', async () => {
    const recordRendererError = vi.fn().mockResolvedValue({ schemaVersion: 1, eventId: 7 });
    vi.stubGlobal('window', { codesign: { diagnostics: { recordRendererError } } });
    useCodesignStore.setState({ reportableErrors: [] });
    const id = useCodesignStore.getState().createReportableError({
      code: 'X',
      scope: 'y',
      message: 'boom',
    });
    await Promise.resolve();
    await Promise.resolve();
    const record = useCodesignStore.getState().getReportableError(id);
    expect(record?.persistedEventId).toBe(7);
    expect(record?.persistedFingerprint).toBeUndefined();
  });
});

describe('extractCodesignErrorCode', () => {
  it('returns the code property when it is a non-empty string', () => {
    expect(extractCodesignErrorCode({ code: 'ATTACHMENT_TOO_LARGE' })).toBe('ATTACHMENT_TOO_LARGE');
  });

  it('returns undefined for missing / empty / non-string code', () => {
    expect(extractCodesignErrorCode({})).toBeUndefined();
    expect(extractCodesignErrorCode({ code: '' })).toBeUndefined();
    expect(extractCodesignErrorCode({ code: 42 })).toBeUndefined();
    expect(extractCodesignErrorCode(null)).toBeUndefined();
    expect(extractCodesignErrorCode('string')).toBeUndefined();
  });

  it('reads code off a real Error with a .code property', () => {
    const err = new Error('boom') as Error & { code?: string };
    err.code = 'CONFIG_MISSING';
    expect(extractCodesignErrorCode(err)).toBe('CONFIG_MISSING');
  });
});

describe('extractUpstreamContext', () => {
  it('picks up NormalizedProviderError fields off a caught error', () => {
    const err = Object.assign(new Error('http 429'), {
      upstream_provider: 'openai',
      upstream_status: 429,
      upstream_request_id: 'req-7',
      retry_count: 3,
    });
    expect(extractUpstreamContext(err)).toEqual({
      upstream_provider: 'openai',
      upstream_status: 429,
      upstream_request_id: 'req-7',
      retry_count: 3,
    });
  });

  it('returns undefined when no upstream fields are present', () => {
    expect(extractUpstreamContext(new Error('plain'))).toBeUndefined();
    expect(extractUpstreamContext({})).toBeUndefined();
    expect(extractUpstreamContext(null)).toBeUndefined();
  });
});

describe('applyGenerateError via sendPrompt', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  async function runFailingGenerate(err: unknown): Promise<void> {
    const recordRendererError = vi.fn().mockResolvedValue({ eventId: null });
    vi.stubGlobal('window', {
      codesign: {
        generate: vi.fn().mockRejectedValue(err),
        diagnostics: { recordRendererError },
      },
    });
    resetStore();
    useCodesignStore.setState({ reportableErrors: [] });
    await useCodesignStore.getState().sendPrompt({ prompt: 'hello' });
    await Promise.resolve();
    await Promise.resolve();
  }

  it('preserves CodesignError.code from a rejected generate IPC', async () => {
    const err = Object.assign(new Error('file too big'), { code: 'ATTACHMENT_TOO_LARGE' });
    await runFailingGenerate(err);
    const records = useCodesignStore.getState().reportableErrors;
    expect(records).toHaveLength(1);
    expect(records[0]?.code).toBe('ATTACHMENT_TOO_LARGE');
    expect(records[0]?.scope).toBe('generate');
  });

  it('falls back to GENERATION_FAILED when no code is present', async () => {
    await runFailingGenerate(new Error('opaque network blip'));
    const records = useCodesignStore.getState().reportableErrors;
    expect(records).toHaveLength(1);
    expect(records[0]?.code).toBe('GENERATION_FAILED');
  });

  it('attaches upstream context from a NormalizedProviderError-shaped error', async () => {
    const err = Object.assign(new Error('http 502'), {
      code: 'PROVIDER_HTTP_5XX',
      upstream_provider: 'anthropic',
      upstream_status: 502,
      retry_count: 2,
    });
    await runFailingGenerate(err);
    const records = useCodesignStore.getState().reportableErrors;
    expect(records[0]?.code).toBe('PROVIDER_HTTP_5XX');
    expect(records[0]?.context).toEqual({
      upstream_provider: 'anthropic',
      upstream_status: 502,
      retry_count: 2,
    });
  });
});

describe('useCodesignStore workspace rebind confirmation flow', () => {
  const mockDesign = {
    schemaVersion: 1 as const,
    id: 'design-1',
    name: 'Test Design',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    thumbnailText: null,
    deletedAt: null,
    workspacePath: '/old/path',
  };

  it('requestWorkspaceRebind sets pending state with design and new path', () => {
    useCodesignStore.setState({ designs: [mockDesign], currentDesignId: 'design-1' });

    useCodesignStore.getState().requestWorkspaceRebind(mockDesign, '/new/path');

    const state = useCodesignStore.getState();
    expect(state.workspaceRebindPending).toEqual({
      design: mockDesign,
      newPath: '/new/path',
    });
  });

  it('cancelWorkspaceRebind clears pending state', () => {
    useCodesignStore.setState({
      workspaceRebindPending: {
        design: mockDesign,
        newPath: '/new/path',
      },
    });

    useCodesignStore.getState().cancelWorkspaceRebind();

    expect(useCodesignStore.getState().workspaceRebindPending).toBeNull();
  });

  it('confirmWorkspaceRebind(false) calls updateWorkspace with migrateFiles=false, refreshes designs, and clears pending', async () => {
    const updatedDesign = { ...mockDesign, workspacePath: '/new/path' };
    const updateWorkspace = vi.fn().mockResolvedValue(updatedDesign);
    const listDesigns = vi.fn().mockResolvedValue([updatedDesign]);

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          updateWorkspace,
          listDesigns,
        },
      },
    });

    useCodesignStore.setState({
      designs: [mockDesign],
      currentDesignId: 'design-1',
      workspaceRebindPending: {
        design: mockDesign,
        newPath: '/new/path',
      },
    });

    await useCodesignStore.getState().confirmWorkspaceRebind(false);

    expect(updateWorkspace).toHaveBeenCalledWith('design-1', '/new/path', false);
    expect(listDesigns).toHaveBeenCalledOnce();
    expect(useCodesignStore.getState().workspaceRebindPending).toBeNull();
    expect(useCodesignStore.getState().designs[0]?.workspacePath).toBe('/new/path');
  });

  it('confirmWorkspaceRebind(true) calls updateWorkspace with migrateFiles=true, refreshes designs, and clears pending', async () => {
    const updatedDesign = { ...mockDesign, workspacePath: '/new/path' };
    const updateWorkspace = vi.fn().mockResolvedValue(updatedDesign);
    const listDesigns = vi.fn().mockResolvedValue([updatedDesign]);

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          updateWorkspace,
          listDesigns,
        },
      },
    });

    useCodesignStore.setState({
      designs: [mockDesign],
      currentDesignId: 'design-1',
      workspaceRebindPending: {
        design: mockDesign,
        newPath: '/new/path',
      },
    });

    await useCodesignStore.getState().confirmWorkspaceRebind(true);

    expect(updateWorkspace).toHaveBeenCalledWith('design-1', '/new/path', true);
    expect(listDesigns).toHaveBeenCalledOnce();
    expect(useCodesignStore.getState().workspaceRebindPending).toBeNull();
    expect(useCodesignStore.getState().designs[0]?.workspacePath).toBe('/new/path');
  });

  it('confirmWorkspaceRebind handles updateWorkspace errors gracefully', async () => {
    const updateWorkspace = vi.fn().mockRejectedValue(new Error('Update failed'));

    vi.stubGlobal('window', {
      codesign: {
        snapshots: {
          updateWorkspace,
        },
      },
    });

    useCodesignStore.setState({
      designs: [mockDesign],
      currentDesignId: 'design-1',
      workspaceRebindPending: {
        design: mockDesign,
        newPath: '/new/path',
      },
    });

    await expect(useCodesignStore.getState().confirmWorkspaceRebind(false)).rejects.toThrow(
      'Update failed',
    );
    // Pending state should still be cleared on error
    expect(useCodesignStore.getState().workspaceRebindPending).toBeNull();
  });
});

describe('useCodesignStore generation-blocking workspace guards', () => {
  const mockDesign = {
    schemaVersion: 1 as const,
    id: 'design-1',
    name: 'Test Design',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    thumbnailText: null,
    deletedAt: null,
    workspacePath: null,
  };

  it('blocks requestWorkspaceRebind when current design is generating', () => {
    useCodesignStore.setState({
      designs: [mockDesign],
      currentDesignId: 'design-1',
      isGenerating: true,
      generatingDesignId: 'design-1',
      workspaceRebindPending: null,
    });

    useCodesignStore.getState().requestWorkspaceRebind(mockDesign, '/new/path');

    // Should not set pending state when generation is active
    expect(useCodesignStore.getState().workspaceRebindPending).toBeNull();
  });

  it('allows requestWorkspaceRebind when a different design is generating', () => {
    useCodesignStore.setState({
      designs: [mockDesign, { ...mockDesign, id: 'design-2' }],
      currentDesignId: 'design-1',
      isGenerating: true,
      generatingDesignId: 'design-2',
      workspaceRebindPending: null,
    });

    useCodesignStore.getState().requestWorkspaceRebind(mockDesign, '/new/path');

    // Should allow rebind when generation is for a different design
    expect(useCodesignStore.getState().workspaceRebindPending).toEqual({
      design: mockDesign,
      newPath: '/new/path',
    });
  });

  it('allows requestWorkspaceRebind when not generating', () => {
    useCodesignStore.setState({
      designs: [mockDesign],
      currentDesignId: 'design-1',
      isGenerating: false,
      generatingDesignId: null,
      workspaceRebindPending: null,
    });

    useCodesignStore.getState().requestWorkspaceRebind(mockDesign, '/new/path');

    expect(useCodesignStore.getState().workspaceRebindPending).toEqual({
      design: mockDesign,
      newPath: '/new/path',
    });
  });
});
