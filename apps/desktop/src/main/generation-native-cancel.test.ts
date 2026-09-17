import { EventEmitter } from 'node:events';
import type { AgentOptions, StreamFn } from '@mariozechner/pi-agent-core';
import { type AssistantMessage, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import { generateViaAgent } from '@open-codesign/core';
import { describe, expect, it, vi } from 'vitest';
import { listPendingAskRequests, requestAsk } from './ask-ipc';
import {
  acquireInFlightWorkspaceGeneration,
  cancelGenerationRequest,
  type InFlightGeneration,
  listInFlightGenerations,
  withInFlightGenerationForDesign,
} from './generation-ipc';

const native = vi.hoisted(() => ({ stream: vi.fn<StreamFn>() }));
vi.mock('@mariozechner/pi-agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-agent-core')>();
  return {
    ...actual,
    Agent: class extends actual.Agent {
      constructor(options: AgentOptions) {
        super({ ...options, streamFn: native.stream });
      }
    },
  };
});
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }));

describe('native generation cancellation ownership', () => {
  it('settles real ask on cancel while retaining design/workspace ownership until host finally completes', async () => {
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        send: vi.fn(),
      }),
    }) as unknown as Electron.BrowserWindow;
    const controllers = new Map<string, AbortController>();
    const designs = new Map<string, InFlightGeneration>();
    const workspaces = new Map<string, InFlightGeneration>();
    const controller = new AbortController();
    const write = vi.fn();
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let settledCore = false;
    native.stream.mockImplementation((model) => {
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        stopReason: 'toolUse',
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        content: [
          {
            type: 'toolCall',
            id: 'todos',
            name: 'set_todos',
            arguments: { items: [{ text: 'Ask then design', checked: false }] },
          },
          {
            type: 'toolCall',
            id: 'ask',
            name: 'ask',
            arguments: {
              questions: [{ type: 'freeform', id: 'required', prompt: 'Required fact?' }],
            },
          },
          {
            type: 'toolCall',
            id: 'write',
            name: 'str_replace_based_edit_tool',
            arguments: { command: 'create', path: 'after-stop.txt', file_text: 'Must never write' },
          },
          { type: 'toolCall', id: 'done', name: 'done', arguments: { path: 'after-stop.txt' } },
        ],
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'toolUse', message });
      return stream;
    });
    const running = withInFlightGenerationForDesign(
      'old',
      'design',
      controllers,
      designs,
      controller,
      async () => {
        const releaseWorkspace = acquireInFlightWorkspaceGeneration('old', 'workspace', workspaces);
        try {
          return await generateViaAgent(
            {
              prompt: 'Make the design after asking',
              history: [],
              systemPrompt: 'Use tools',
              apiKey: 'synthetic-only',
              model: { provider: 'openai', modelId: 'gpt-5' },
              signal: controller.signal,
              askBridge: (input, signal) => requestAsk('old', input, () => window, signal),
            },
            {
              fs: {
                view: () => null,
                listDir: () => [],
                create: (path) => {
                  write(path);
                  return { path };
                },
                strReplace: (path) => {
                  write(path);
                  return { path };
                },
                insert: (path) => {
                  write(path);
                  return { path };
                },
              },
            },
          );
        } finally {
          settledCore = true;
          await cleanup;
          releaseWorkspace();
        }
      },
    );
    const rejected = expect(running).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    await vi.waitFor(() => expect(listPendingAskRequests()).toHaveLength(1));
    const requestId = listPendingAskRequests()[0]?.requestId;
    cancelGenerationRequest('old', controllers, { info: vi.fn() }, designs, workspaces);
    await vi.waitFor(() => expect(settledCore).toBe(true));
    expect(listPendingAskRequests()).toEqual([]);
    expect(window.webContents.send).toHaveBeenCalledWith('ask:cancelled', {
      schemaVersion: 1,
      sessionId: 'old',
      requestId,
    });
    expect(listInFlightGenerations(designs)).toEqual([
      { designId: 'design', generationId: 'old', startedAt: expect.any(Number) },
    ]);
    expect(controllers.get('old')).toBe(controller);
    const replacement = vi.fn(async () => 'new run');
    await expect(
      withInFlightGenerationForDesign(
        'new',
        'design',
        controllers,
        designs,
        new AbortController(),
        replacement,
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_ALREADY_RUNNING' });
    expect(() => acquireInFlightWorkspaceGeneration('new', 'workspace', workspaces)).toThrow(
      /already running/,
    );
    expect(replacement).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    releaseCleanup();
    await rejected;
    expect(controllers.size).toBe(0);
    expect(designs.size).toBe(0);
    expect(workspaces.size).toBe(0);
    await expect(
      withInFlightGenerationForDesign(
        'new',
        'design',
        controllers,
        designs,
        new AbortController(),
        replacement,
      ),
    ).resolves.toBe('new run');
    expect(native.stream).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});
