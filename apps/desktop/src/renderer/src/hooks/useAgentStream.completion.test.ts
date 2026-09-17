import { initI18n } from '@open-codesign/i18n';
import type {
  ActiveRunMessageInputV1,
  ChatAppendInput,
  ChatMessageRow,
} from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../../../preload/index';
import { type CodesignState, useCodesignStore } from '../store';
import { useAgentStream } from './useAgentStream';

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));

vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useEffect: (effect: () => undefined | (() => void)) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
  useRef: (current: unknown) => ({ current }),
}));

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    useCodesignStore: Object.assign(
      (selector: (state: CodesignState) => unknown) => selector(actual.useCodesignStore.getState()),
      actual.useCodesignStore,
    ),
  };
});

const initialState = useCodesignStore.getState();
const design = {
  schemaVersion: 1 as const,
  id: 'completion-test',
  name: 'Aurora',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  thumbnailText: null,
  deletedAt: null,
  workspacePath: '/tmp/codesign-completion-test',
};
let listener: ((event: AgentStreamEvent) => void) | undefined;
const append = vi.fn(async (input: { designId: string; kind: string; payload: unknown }) => ({
  ...input,
  id: 'row',
  seq: 1,
  createdAt: new Date().toISOString(),
}));
const generate = vi.fn();

function emit(
  type: AgentStreamEvent['type'],
  generationId: string,
  extra: Partial<AgentStreamEvent> = {},
): void {
  if (!listener) throw new Error('Agent stream listener not registered');
  listener({
    type,
    generationId,
    designId: design.id,
    message: '400 unsupported reasoning',
    ...extra,
  });
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useCodesignStore.setState({
    ...initialState,
    config: {
      hasKey: true,
      provider: 'custom-local',
      modelPrimary: 'gpt-6-astra',
      baseUrl: null,
      designSystem: null,
    },
    configLoaded: true,
    designs: [design],
    designsLoaded: true,
    currentDesignId: design.id,
    persistAgentRunSnapshot: vi.fn(async () => {}),
    tryAutoPolish: vi.fn(),
  });
  vi.stubGlobal('window', {
    setTimeout,
    codesign: {
      generate,
      generationStatus: vi.fn(async () => ({ schemaVersion: 1, running: [] })),
      snapshots: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: 'snapshot' })),
        setThumbnail: vi.fn(async () => design),
        listDesigns: vi.fn(async () => [design]),
      },
      chat: {
        append,
        updateToolStatus: vi.fn(async () => {}),
        list: vi.fn(async () => []),
        seedFromSnapshots: vi.fn(async () => {}),
        onAgentEvent: (callback: (event: AgentStreamEvent) => void) => {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
      },
    },
  });
  useAgentStream();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('agent stream / IPC completion ordering', () => {
  it('keeps exactly one canonical active message through delivery, turn end and completion', async () => {
    const get = useCodesignStore.getState;
    const rows: ChatMessageRow[] = [];
    const persist = (input: ChatAppendInput): ChatMessageRow => {
      const row: ChatMessageRow = {
        ...input,
        schemaVersion: 1,
        id: rows.length + 1,
        seq: rows.length + 1,
        snapshotId: input.snapshotId ?? null,
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return row;
    };
    const api = window.codesign;
    if (!api) throw new Error('Missing test IPC');
    api.chat.append = vi.fn(async (input) => persist(input));
    const list = vi.fn(async () => [...rows]);
    api.chat.list = list;
    api.sendActiveMessage = vi.fn(async (input: ActiveRunMessageInputV1) => ({
      ...input,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }));
    let finish!: () => void;
    generate.mockImplementationOnce(
      ({ generationId, referenceUrl }: { generationId: string; referenceUrl: string }) => {
        expect(referenceUrl).toBe('https://example.com/reference');
        emit('turn_start', generationId);
        return new Promise((resolve) => {
          finish = () =>
            resolve({
              artifacts: [],
              message: 'Finished',
              inputTokens: 1,
              outputTokens: 1,
              costUsd: 0,
            });
        });
      },
    );
    get().setReferenceUrl('https://example.com/reference');
    const generation = get().sendPrompt({ prompt: 'Start with the reference' });
    await vi.advanceTimersByTimeAsync(0);
    expect(generate).toHaveBeenCalledOnce();
    const generationId = get().generationByDesign[design.id]?.generationId;
    if (!generationId) throw new Error('Missing running generation');
    get().setComposerDraft('Make it warmer');
    await get().sendActiveMessage('Make it warmer', 'steer');
    const pending = get().activeMessagesByDesign[design.id]?.[0];
    if (!pending) throw new Error('Missing pending active message');
    expect(get().chatMessages.map((row) => row.payload)).toEqual([
      { text: 'Start with the reference' },
    ]);
    let resolveOld!: (rows: ChatMessageRow[]) => void;
    const oldRows = [...rows];
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const oldLoad = get().loadChatForCurrentDesign();
    await vi.advanceTimersByTimeAsync(0);
    persist({ designId: design.id, kind: 'user', payload: { text: 'Make it warmer' } });
    emit('active_message', generationId, {
      activeMessage: { ...pending, status: 'delivered' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(get().chatMessages).toEqual(rows);
    persist({ designId: design.id, kind: 'assistant_text', payload: { text: 'Finished' } });
    emit('turn_end', generationId, { finalText: 'Finished', chatPersisted: true });
    emit('agent_end', generationId);
    await vi.advanceTimersByTimeAsync(0);
    expect(get().generationByDesign[design.id]?.submittedContext?.referenceUrl).toBe(
      'https://example.com/reference',
    );
    finish();
    await generation;
    resolveOld(oldRows);
    await oldLoad;
    expect(get().chatMessages).toEqual(rows);
    expect(get().chatMessages.filter((row) => row.kind === 'user')).toHaveLength(2);
    expect(get().chatMessages.filter((row) => row.kind === 'assistant_text')).toHaveLength(1);
    expect(api.chat.append).toHaveBeenCalledOnce();
    expect(get().activeMessagesByDesign[design.id]?.[0]?.status).toBe('delivered');
    expect(get().generationByDesign[design.id]).toBeUndefined();
    expect(get().referenceUrl).toBe('https://example.com/reference');
    expect(get().isGenerating).toBe(false);
  });

  it('keeps assistant fragments in memory across tool start until the host-persisted turn end', async () => {
    const reload = vi.fn(async () => {});
    useCodesignStore.setState({ loadChatForCurrentDesign: reload });
    emit('turn_start', 'fragments');
    emit('text_delta', 'fragments', { delta: 'Before tool. ' });
    emit('tool_call_start', 'fragments', { toolName: 'read', toolCallId: 'read-file' });
    await Promise.resolve();
    expect(append.mock.calls.map(([input]) => input.kind)).toEqual(['tool_call']);
    expect(useCodesignStore.getState().streamingAssistantTextByDesign[design.id]).toBe(
      'Before tool. ',
    );
    emit('text_delta', 'fragments', { delta: 'After tool.' });
    emit('turn_end', 'fragments', {
      finalText: 'Before tool. After tool.',
      chatPersisted: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(append.mock.calls.map(([input]) => input.kind)).toEqual(['tool_call']);
    expect(window.codesign?.chat.updateToolStatus).toHaveBeenCalledWith({
      designId: design.id,
      seq: 1,
      status: 'done',
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(useCodesignStore.getState().streamingAssistantTextByDesign[design.id]).toBeUndefined();
    expect(useCodesignStore.getState().generationByDesign[design.id]?.streamedAssistantText).toBe(
      'Before tool. After tool.',
    );
  });

  it('reloads host-persisted assistant text without appending and still finalizes streaming/dedupe', () => {
    const reload = vi.fn(async () => {});
    useCodesignStore.setState({
      loadChatForCurrentDesign: reload,
      generationByDesign: {
        [design.id]: { generationId: 'host-persisted', stage: 'thinking', awaitingResponse: true },
      },
    });
    emit('turn_start', 'host-persisted');
    emit('text_delta', 'host-persisted', { delta: '  Finished the previous turn  ' });
    expect(useCodesignStore.getState().streamingAssistantTextByDesign[design.id]).toBe(
      '  Finished the previous turn  ',
    );
    emit('turn_end', 'host-persisted', {
      finalText: '  Finished the previous turn  ',
      chatPersisted: true,
    });
    expect(append).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
    expect(useCodesignStore.getState().streamingAssistantTextByDesign[design.id]).toBeUndefined();
    expect(useCodesignStore.getState().generationByDesign[design.id]).toMatchObject({
      awaitingResponse: true,
      streamedAssistantText: 'Finished the previous turn',
    });
    emit('turn_end', 'host-persisted', { finalText: 'Finished the previous turn' });
    expect(append).not.toHaveBeenCalled();
    emit('agent_end', 'host-persisted');
    expect(useCodesignStore.getState().persistAgentRunSnapshot).toHaveBeenCalledWith({
      designId: design.id,
      finalText: '  Finished the previous turn  ',
    });
    expect(useCodesignStore.getState().generationByDesign[design.id]?.awaitingResponse).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not replace visible chat for a host-persisted background turn', () => {
    const reload = vi.fn(async () => {});
    useCodesignStore.setState({ loadChatForCurrentDesign: reload });
    emit('turn_start', 'background');
    useCodesignStore.setState({ currentDesignId: 'other-design' });
    emit('turn_end', 'background', { finalText: 'Background result', chatPersisted: true });
    expect(reload).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(useCodesignStore.getState().streamingAssistantTextByDesign[design.id]).toBeUndefined();
  });

  it.each([
    false,
    undefined,
  ])('preserves normal assistant append when chatPersisted is %s', (chatPersisted) => {
    emit('turn_start', 'normal');
    emit('turn_end', 'normal', {
      finalText: 'Normal result',
      ...(chatPersisted !== undefined ? { chatPersisted } : {}),
    });
    expect(append).toHaveBeenCalledWith({
      designId: design.id,
      kind: 'assistant_text',
      payload: { text: 'Normal result' },
    });
  });

  it('reconciles active message outcomes after Stop without reactivating generation', () => {
    const message = {
      schemaVersion: 1 as const,
      designId: design.id,
      generationId: 'stopped',
      messageId: 'pending-message',
      mode: 'follow-up' as const,
      text: 'Keep this recoverable',
      status: 'pending' as const,
      createdAt: '2026-09-17T00:00:00Z',
    };
    useCodesignStore.setState({
      cancelledGenerationIds: new Set(['stopped']),
      activeMessagesByDesign: { [design.id]: [message] },
    });
    emit('active_message', 'stopped', {
      activeMessage: { ...message, status: 'not-delivered', reason: 'Stopped' },
    });
    expect(useCodesignStore.getState().activeMessagesByDesign[design.id]?.[0]?.status).toBe(
      'not-delivered',
    );
    expect(useCodesignStore.getState().isGenerating).toBe(false);
    expect(append).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('ignores active message events whose envelope belongs to a different design', () => {
    useCodesignStore.getState().markGenerationRunning(design.id, 'active');
    emit('active_message', 'active', {
      activeMessage: {
        schemaVersion: 1,
        designId: 'different-design',
        generationId: 'active',
        messageId: 'wrong-design',
        mode: 'steer',
        text: 'Do not merge',
        status: 'pending',
        createdAt: '2026-09-17T00:00:00Z',
      },
    });
    expect(useCodesignStore.getState().activeMessagesByDesign).toEqual({});
  });

  it.each([
    'agent_end',
    'error',
  ] as const)('shows the IPC failure even when %s arrives first', async (eventType) => {
    useCodesignStore.getState().setReferenceUrl('https://example.com/reference');
    generate.mockImplementationOnce(async ({ generationId }: { generationId: string }) => {
      emit('turn_start', generationId);
      emit(eventType, generationId);
      expect(useCodesignStore.getState().generationByDesign[design.id]).toMatchObject({
        generationId,
        awaitingResponse: true,
        submittedContext: { referenceUrl: 'https://example.com/reference', comments: {} },
      });
      throw new Error('400 unsupported reasoning');
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'Create an Aurora design' });

    expect(useCodesignStore.getState().errorMessage).toContain('400 unsupported reasoning');
    expect(useCodesignStore.getState().generationStage).toBe('error');
    expect(useCodesignStore.getState().isGenerating).toBe(false);
    expect(useCodesignStore.getState().generationByDesign[design.id]).toBeUndefined();
    expect(useCodesignStore.getState().referenceUrl).toBe('https://example.com/reference');
    expect(append.mock.calls.filter(([row]) => row.kind === 'error')).toHaveLength(1);
    expect(useCodesignStore.getState().toasts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(useCodesignStore.getState().tryAutoPolish).not.toHaveBeenCalled();
  });

  it('retains artifacts and usage from the response after agent_end', async () => {
    generate.mockImplementationOnce(async ({ generationId }: { generationId: string }) => {
      emit('turn_start', generationId);
      emit('agent_end', generationId);
      return {
        artifacts: [{ content: '<main>Aurora</main>', entryPath: 'App.jsx' }],
        message: 'Ready',
        inputTokens: 100,
        outputTokens: 200,
        costUsd: 0,
      };
    });

    await useCodesignStore.getState().sendPrompt({ prompt: 'Create an Aurora design' });

    expect(useCodesignStore.getState().previewSource).toBe('<main>Aurora</main>');
    expect(useCodesignStore.getState().lastUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(useCodesignStore.getState().isGenerating).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(useCodesignStore.getState().tryAutoPolish).toHaveBeenCalledWith(design.id, 'en');
  });

  it('still finishes a rehydrated run that has no pending local response', () => {
    useCodesignStore.getState().markGenerationRunning(design.id, 'rehydrated');
    emit('agent_end', 'rehydrated');

    expect(useCodesignStore.getState().generationByDesign[design.id]).toBeUndefined();
    expect(useCodesignStore.getState().isGenerating).toBe(false);
    expect(useCodesignStore.getState().generationStage).toBe('done');
  });

  it('does not lose a pending response when main already reports the run finished', async () => {
    generate.mockImplementationOnce(async ({ generationId }: { generationId: string }) => {
      emit('agent_end', generationId);
      await useCodesignStore.getState().syncGenerationStatus();
      throw new Error('late rejection');
    });
    await useCodesignStore.getState().sendPrompt({ prompt: 'Aurora' });
    expect(useCodesignStore.getState().errorMessage).toContain('late rejection');
  });

  it('ignores an old response after a newer run owns the design', async () => {
    generate.mockImplementationOnce(async ({ generationId }: { generationId: string }) => {
      emit('agent_end', generationId);
      useCodesignStore.getState().markGenerationRunning(design.id, 'newer-run');
      throw new Error('old error');
    });
    await useCodesignStore.getState().sendPrompt({ prompt: 'Aurora' });
    expect(useCodesignStore.getState().errorMessage).toBeNull();
    expect(useCodesignStore.getState().activeGenerationId).toBe('newer-run');
    expect(append.mock.calls.filter(([row]) => row.kind === 'error')).toHaveLength(0);
  });

  it('keeps a background response from replacing another design preview', async () => {
    generate.mockImplementationOnce(async ({ generationId }: { generationId: string }) => {
      emit('turn_start', generationId);
      useCodesignStore.setState({ currentDesignId: 'other-design', previewSource: 'Other' });
      emit('turn_end', generationId, { finalText: 'Ready' });
      emit('agent_end', generationId);
      return { artifacts: [{ content: '<main>Aurora</main>' }], message: 'Ready' };
    });
    await useCodesignStore.getState().sendPrompt({ prompt: 'Aurora' });
    expect(useCodesignStore.getState().previewSource).toBe('Other');
    expect(useCodesignStore.getState().previewSourceByDesign[design.id]).toBe(
      '<main>Aurora</main>',
    );
    expect(append.mock.calls.filter(([row]) => row.kind === 'assistant_text')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
  });
});
