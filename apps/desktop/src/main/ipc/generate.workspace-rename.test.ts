import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '@mariozechner/pi-agent-core';
import { createAssistantMessageEventStream, getModel } from '@mariozechner/pi-ai';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, raw: unknown) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const fixtureRootName = vi.hoisted(() => `codesign-gen-${process.pid}-${Date.now()}`);
const coreCalls = vi.hoisted(() => ({
  generateInputs: [] as unknown[],
  routeResults: [] as Array<{
    preferences: {
      schemaVersion: 1;
      tweaks: 'auto';
      bitmapAssets: 'auto';
      reusableSystem: 'auto';
    };
    needsClarification: boolean;
    clarificationRationale?: string;
    clarificationQuestions?: Array<
      | {
          id: string;
          type: 'text-options';
          prompt: string;
          options: string[];
        }
      | {
          id: string;
          type: 'freeform';
          prompt: string;
          placeholder?: string;
          multiline?: boolean;
        }
    >;
  }>,
}));
const generateControl = vi.hoisted(() => {
  let markStarted: (() => void) | null = null;
  let release: (() => void) | null = null;
  let started: Promise<void>;
  let unblock: Promise<void>;
  return {
    reset(): void {
      started = new Promise((resolve) => {
        markStarted = resolve;
      });
      unblock = new Promise((resolve) => {
        release = resolve;
      });
    },
    get started(): Promise<void> {
      return started;
    },
    markStarted(): void {
      markStarted?.();
    },
    release(): void {
      release?.();
    },
    async waitUntilReleased(): Promise<void> {
      await unblock;
    },
  };
});
generateControl.reset();

// This suite exercises IPC handlers in Node, never an Electron process.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => path.join(os.tmpdir(), fixtureRootName)) },
  ipcMain: { handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)) },
}));
vi.mock('../electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), fixtureRootName)),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@open-codesign/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-codesign/core')>();
  return {
    ...actual,
    generateViaAgent: vi.fn(async (input: unknown) => {
      coreCalls.generateInputs.push(input);
      generateControl.markStarted();
      await generateControl.waitUntilReleased();
      return { message: 'done', artifacts: [], inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }),
    loadDesignSkills: vi.fn(async () => []),
    loadFrameTemplates: vi.fn(async () => []),
    routeRunPreferences: vi.fn(
      async () =>
        coreCalls.routeResults.shift() ?? {
          preferences: {
            schemaVersion: 1,
            tweaks: 'auto',
            bitmapAssets: 'auto',
            reusableSystem: 'auto',
          },
          needsClarification: false,
        },
    ),
  };
});

vi.mock('@open-codesign/providers', () => ({
  detectProviderFromKey: vi.fn(() => 'mock'),
  generateImage: vi.fn(),
}));

vi.mock('../provider-settings', () => ({
  resolveActiveModel: vi.fn((_cfg: unknown, model: { provider: string; modelId: string }) => ({
    model,
    allowKeyless: false,
    overridden: false,
    wire: 'anthropic',
  })),
}));

vi.mock('../onboarding-ipc', () => ({
  getApiKeyForProvider: vi.fn(() => 'sk-test'),
  getCachedConfig: vi.fn(() => ({
    provider: 'mock-provider',
    modelPrimary: 'mock-model',
    secrets: {},
    designSystem: null,
  })),
  hasApiKeyForProvider: vi.fn(() => true),
}));

vi.mock('../resolve-api-key', () => ({
  resolveActiveApiKey: vi.fn(async () => 'sk-test'),
  resolveCredentialForProvider: vi.fn(async () => 'sk-test'),
}));

vi.mock('../preferences-ipc', () => ({
  readPersisted: vi.fn(async () => ({
    generationTimeoutSec: 0,
    memoryEnabled: false,
    workspaceMemoryAutoUpdate: false,
    userMemoryAutoUpdate: false,
  })),
}));

vi.mock('../prompt-context', () => ({
  preparePromptContext: vi.fn(
    async (input?: { attachments?: Array<{ path: string; name: string; size: number }> }) => ({
      attachments:
        input?.attachments?.map((file) => ({
          ...file,
          ...(file.name.toLowerCase().endsWith('.png') ? { mediaType: 'image/png' } : {}),
        })) ?? [],
      referenceUrl: null,
      designSystem: null,
      projectContext: {},
    }),
  ),
}));

vi.mock('../memory-ipc', () => ({
  loadMemoryContext: vi.fn(async () => undefined),
  triggerUserMemoryCandidateCapture: vi.fn(async () => undefined),
  triggerUserMemoryConsolidation: vi.fn(async () => undefined),
  triggerWorkspaceMemoryUpdate: vi.fn(async () => null),
  workspaceNameFromPath: vi.fn((workspacePath: string) => path.basename(workspacePath)),
}));

vi.mock('../done-verify', () => ({
  makeRuntimeVerifier: vi.fn(() => async () => []),
}));

vi.mock('../preview-runtime', () => ({
  runPreview: vi.fn(async () => ({ errors: [] })),
}));

vi.mock('../ask-ipc', () => ({
  requestAsk: vi.fn(async () => ({ status: 'answered', answers: [] })),
}));

import {
  type AskInput,
  type AskResult,
  generateViaAgent,
  makeAskTool,
  makeTextEditorTool,
  type RunPreviewOptions,
  routeRunPreferences,
} from '@open-codesign/core';
import { requestAsk } from '../ask-ipc';
import { makeRuntimeVerifier } from '../done-verify';
import { runPreview } from '../preview-runtime';
import { preparePromptContext } from '../prompt-context';
import {
  appendSessionActiveMessage,
  appendSessionChatMessage,
  appendSessionToolStatus,
  listSessionActiveMessages,
  listSessionChatMessages,
} from '../session-chat';
import {
  createDesign,
  initInMemoryDb,
  listSnapshots,
  updateDesignWorkspace,
} from '../snapshots-db';
import { registerSnapshotsIpc } from '../snapshots-ipc';
import { registerSourceEditsIpc } from '../source-edits-ipc';
import { normalizeWorkspacePath } from '../workspace-path';
import { registerGenerateIpc } from './generate';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

describe('generate IPC workspace rename coordination', () => {
  const documentsRoot = path.join(os.tmpdir(), fixtureRootName);
  const defaultWorkspaceRoot = path.join(documentsRoot, 'CoDesign');
  let pendingFixtureGeneration: Promise<unknown> | null = null;

  function initTestDb() {
    return {
      ...initInMemoryDb(),
      dataDir: path.join(documentsRoot, 'data'),
      sessionDir: path.join(documentsRoot, 'sessions'),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(requestAsk).mockReset().mockResolvedValue({ status: 'answered', answers: [] });
    handlers.clear();
    coreCalls.generateInputs.length = 0;
    coreCalls.routeResults.length = 0;
    pendingFixtureGeneration = null;
    generateControl.reset();
    await rm(documentsRoot, { recursive: true, force: true });
    await mkdir(defaultWorkspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    generateControl.release();
    try {
      await pendingFixtureGeneration;
    } finally {
      await rm(documentsRoot, { recursive: true, force: true });
    }
  });

  it('gates source edits with the real generation maps, shared workspace aliases and registry lifecycle', async () => {
    const db = initTestDb();
    const design = createDesign(db, 'Generating source');
    const other = createDesign(db, 'Alias editor');
    const workspace = path.join(defaultWorkspaceRoot, 'source-busy');
    const alias = path.join(documentsRoot, 'source-alias');
    await mkdir(workspace);
    await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const content = 'function App() { return <h1>Title</h1>; }';
    await writeFile(path.join(workspace, 'App.jsx'), content);
    updateDesignWorkspace(db, design.id, workspace);
    updateDesignWorkspace(db, other.id, alias);
    const dispose = registerGenerateIpc({ db, getMainWindow: () => null });
    registerSourceEditsIpc(db, () => null);
    const inspect = (id: string) =>
      Promise.resolve(
        getHandler('codesign:source-edits:v1:inspect')(null, {
          schemaVersion: 1,
          designId: id,
          path: 'App.jsx',
          expectedContent: content,
        }),
      );
    try {
      expect(await inspect(other.id)).toMatchObject({ status: 'ready' });
      pendingFixtureGeneration = Promise.resolve(
        getHandler('codesign:v1:generate')(null, {
          schemaVersion: 1,
          generationId: 'source-busy',
          designId: design.id,
          prompt: 'Continue',
          history: [],
          attachments: [],
          model: { provider: 'mock-provider', modelId: 'mock-model' },
        }),
      );
      await generateControl.started;
      expect(await inspect(design.id)).toMatchObject({ status: 'rejected', reason: 'busy' });
      expect(await inspect(other.id)).toMatchObject({ status: 'rejected', reason: 'busy' });
      generateControl.release();
      await pendingFixtureGeneration;
      expect(await inspect(other.id)).toMatchObject({ status: 'ready' });
    } finally {
      dispose();
    }
    expect(await inspect(other.id)).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });
  it('journals headless runs and reattaches by sequence without duplicating chat', async () => {
    vi.mocked(generateViaAgent).mockImplementationOnce(async (_input, deps) => {
      deps?.onEvent?.({ type: 'turn_start' });
      deps?.onEvent?.({
        type: 'tool_execution_start',
        toolCallId: 'read-one',
        toolName: 'read',
        args: { path: 'App.jsx' },
      });
      generateControl.markStarted();
      await generateControl.waitUntilReleased();
      deps?.onEvent?.({
        type: 'tool_execution_end',
        toolCallId: 'read-one',
        toolName: 'read',
        isError: false,
        result: { content: [{ type: 'text', text: 'Read source' }] },
      });
      deps?.onEvent?.({ type: 'agent_end', messages: [] });
      return {
        message: 'Completed without a renderer',
        artifacts: [
          {
            id: 'headless-artifact',
            type: 'html',
            title: 'Headless',
            content: '<main>Completed</main>',
            designParams: [],
            createdAt: new Date().toISOString(),
          },
        ],
        inputTokens: 12,
        outputTokens: 34,
        costUsd: 0,
      };
    });
    const db = initTestDb();
    const design = createDesign(db, 'Recover headless');
    updateDesignWorkspace(db, design.id, defaultWorkspaceRoot);
    registerGenerateIpc({ db, getMainWindow: () => null });
    const recover = getHandler('codesign:v1:recover-runs');
    pendingFixtureGeneration = Promise.resolve(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        generationId: 'headless',
        designId: design.id,
        prompt: 'Continue',
        history: [],
        attachments: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
      }),
    );
    await generateControl.started;
    const first = (await recover(null, { schemaVersion: 1, cursors: {} })) as {
      events: Array<{ seq: number; type: string }>;
    };
    expect(first.events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'turn_start'],
      [2, 'tool_call_start'],
    ]);
    expect(
      listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id)[0]?.payload,
    ).toMatchObject({ status: 'running' });
    const firstWindow = { isDestroyed: () => false, send: vi.fn() };
    const secondWindow = { isDestroyed: () => false, send: vi.fn() };
    await recover({ sender: firstWindow }, { schemaVersion: 1, cursors: { headless: 2 } });
    await recover({ sender: secondWindow }, { schemaVersion: 1, cursors: { headless: 2 } });
    generateControl.release();
    await expect(pendingFixtureGeneration).resolves.toMatchObject({
      chatPersisted: true,
      inputTokens: 12,
    });
    for (const subscriber of [firstWindow, secondWindow])
      expect(subscriber.send).toHaveBeenCalledWith(
        'agent:event:v1',
        expect.objectContaining({ type: 'run_settled', seq: 5 }),
      );
    const tail = (await recover(null, { schemaVersion: 1, cursors: { headless: 2 } })) as {
      events: Array<{ seq: number; type: string }>;
    };
    expect(tail.events.map((event) => event.seq)).toEqual([3, 4, 5]);
    expect(tail.events.at(-1)).toMatchObject({
      type: 'run_settled',
      outcome: 'completed',
      response: { inputTokens: 12, outputTokens: 34 },
    });
    const rows = listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id);
    expect(rows.map((row) => row.kind)).toEqual([
      'tool_call',
      'assistant_text',
      'artifact_delivered',
    ]);
    const snapshots = listSnapshots(db, design.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.artifactSource).toBe('<main>Completed</main>');
    expect(tail.events.at(-1)).toMatchObject({ response: { snapshotId: snapshots[0]?.id } });
    expect(rows[0]?.payload).toMatchObject({ status: 'done' });
    await recover(null, { schemaVersion: 1, cursors: {} });
    registerGenerateIpc({ db, getMainWindow: () => null });
    await getHandler('codesign:v1:recover-runs')(null, { schemaVersion: 1, cursors: {} });
    expect(listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id)).toEqual(rows);
    expect(listSnapshots(db, design.id)).toEqual(snapshots);
    expect(vi.mocked(generateViaAgent)).toHaveBeenCalledOnce();
  });

  it('persists preparation failures and validates recovery cursors', async () => {
    vi.mocked(preparePromptContext).mockRejectedValueOnce(new Error('Reference unavailable'));
    const db = initTestDb();
    const design = createDesign(db, 'Failed preflight');
    updateDesignWorkspace(db, design.id, defaultWorkspaceRoot);
    registerGenerateIpc({ db, getMainWindow: () => null });
    await expect(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        generationId: 'failed-preflight',
        designId: design.id,
        prompt: 'Continue',
        history: [],
        attachments: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
      }),
    ).rejects.toThrow('Reference unavailable');
    const recover = getHandler('codesign:v1:recover-runs');
    const recovered = (await recover(null, { schemaVersion: 1, cursors: {} })) as {
      events: unknown[];
    };
    expect(recovered.events.at(-1)).toMatchObject({
      type: 'run_settled',
      outcome: 'failed',
      message: 'Reference unavailable',
      seq: 1,
    });
    expect(
      listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id).map((row) => row.kind),
    ).toEqual(['error']);
    await expect(recover(null, { schemaVersion: 1, cursors: { '../escape': 1 } })).rejects.toThrow(
      'cursor',
    );
    await expect(recover(null, { schemaVersion: 1, cursors: { run: -1 } })).rejects.toThrow(
      'cursor',
    );
    expect(vi.mocked(generateViaAgent)).not.toHaveBeenCalled();
  });
  it('recovers interrupted persisted requests without starting another generation', async () => {
    const db = initTestDb();
    const design = createDesign(db, 'Recovered requests');
    updateDesignWorkspace(db, design.id, defaultWorkspaceRoot);
    appendSessionActiveMessage(
      { db, sessionDir: db.sessionDir },
      {
        schemaVersion: 1,
        designId: design.id,
        generationId: 'previous-process',
        messageId: 'saved',
        mode: 'follow-up',
        text: 'Keep this draft',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    );
    registerGenerateIpc({ db, getMainWindow: () => null });
    const rows = await getHandler('codesign:v1:active-messages')(null, {
      schemaVersion: 1,
      designId: design.id,
    });
    expect(rows).toMatchObject([
      { messageId: 'saved', status: 'not-delivered', text: 'Keep this draft' },
    ]);
    expect(listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id)).toEqual([]);
    expect(coreCalls.generateInputs).toEqual([]);
  });

  it.each([
    'deliver',
    'cancel',
  ] as const)('tracks active-message IPC delivery without replay or cross-design leakage: %s', async (outcome) => {
    vi.mocked(generateViaAgent).mockImplementationOnce(async (input, deps) => {
      const messages = deps?.activeMessages;
      if (!messages) throw new Error('Active-message bridge missing');
      const model = getModel('openai', 'gpt-4o-mini');
      const agent = new Agent({
        initialState: { model },
        streamFn: () => {
          const stream = createAssistantMessageEventStream();
          stream.push({
            type: 'done',
            reason: 'stop',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'done' }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: 'stop',
              timestamp: Date.now(),
            },
          });
          return stream;
        },
      });
      messages.bind(agent);
      agent.subscribe((event) => {
        messages.handleEvent(event, () => {});
        deps?.onEvent?.(event);
      });
      generateControl.markStarted();
      await generateControl.waitUntilReleased();
      if (!input.signal?.aborted) await agent.prompt('initial');
      messages.close();
      return { message: 'done', artifacts: [], inputTokens: 0, outputTokens: 0, costUsd: 0 };
    });
    const db = initTestDb();
    const design = createDesign(db, 'Active messages');
    const other = createDesign(db, 'Other design');
    const workspace = path.join(defaultWorkspaceRoot, 'active-messages');
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);
    updateDesignWorkspace(db, other.id, workspace);
    registerGenerateIpc({ db, getMainWindow: () => null });
    const send = getHandler('codesign:v1:active-message');
    const list = getHandler('codesign:v1:active-messages');
    const message = {
      schemaVersion: 1,
      designId: design.id,
      generationId: 'active-run',
      messageId: 'one',
      mode: 'follow-up',
      text: 'Adjust the heading',
    };
    await expect(send(null, message)).rejects.toThrow(/not accepting/);
    pendingFixtureGeneration = Promise.resolve(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        prompt: 'Create a poster',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'active-run',
        designId: design.id,
      }),
    );
    await generateControl.started;
    expect(await send(null, message)).toMatchObject({ status: 'pending' });
    expect(await send(null, message)).toMatchObject({ status: 'pending' });
    await expect(send(null, { ...message, messageId: 'two', designId: other.id })).rejects.toThrow(
      /changed/,
    );
    await expect(send(null, { ...message, text: 'Changed duplicate' })).rejects.toThrow(
      /different request/,
    );
    await expect(send(null, { ...message, attachments: [] })).rejects.toThrow();
    expect(listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id)).toEqual([]);
    if (outcome === 'cancel')
      getHandler('codesign:v1:cancel-generation')(null, {
        schemaVersion: 1,
        generationId: 'active-run',
      });
    generateControl.release();
    await pendingFixtureGeneration;
    const status = outcome === 'deliver' ? 'delivered' : 'not-delivered';
    expect(await list(null, { schemaVersion: 1, designId: design.id })).toMatchObject([
      { messageId: 'one', status },
    ]);
    expect(await send(null, message)).toMatchObject({ status });
    expect(listSessionActiveMessages({ db, sessionDir: db.sessionDir }, other.id)).toEqual([]);
    const rows = listSessionChatMessages({ db, sessionDir: db.sessionDir }, design.id);
    expect(rows.filter((row) => row.kind === 'user')).toHaveLength(outcome === 'deliver' ? 1 : 0);
    if (outcome === 'deliver') {
      expect(rows.map((row) => row.kind)).toEqual(['assistant_text', 'user', 'assistant_text']);
    }
    await expect(send(null, { ...message, messageId: 'late' })).rejects.toThrow(/not accepting/);
  });

  it.each([
    { pack: 'common-ground', extraFiles: 0, padding: 0 },
    { pack: 'common-ground', extraFiles: 205, padding: 0 },
    { pack: 'common-ground', extraFiles: 205, padding: 140 },
    { pack: 'daymark', extraFiles: 0, padding: 0 },
    { pack: 'trailhead', extraFiles: 0, padding: 0 },
  ])('provides readable $pack references without App.jsx ($extraFiles extra files, $padding padding)', async ({
    pack,
    extraFiles,
    padding,
  }) => {
    const db = initTestDb();
    const design = createDesign(db, pack);
    const workspace = path.join(defaultWorkspaceRoot, pack);
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);
    const names = await readdir(
      new URL(`../../../resources/demo-inputs/${pack}/`, import.meta.url),
    );
    for (const name of names) {
      const content = await readFile(
        new URL(`../../../resources/demo-inputs/${pack}/${name}`, import.meta.url),
        'utf8',
      );
      await writeFile(path.join(workspace, name), content);
    }
    for (let i = 0; i < extraFiles; i++) {
      await writeFile(
        path.join(workspace, `z-reference-${'x'.repeat(padding)}${i}.txt`),
        'reference',
      );
    }
    await mkdir(path.join(workspace, '.private'));
    await writeFile(path.join(workspace, '.private', 'hidden.txt'), 'not router context');
    vi.mocked(preparePromptContext).mockResolvedValueOnce({
      attachments: [],
      referenceUrl: null,
      designSystem: null,
      projectContext: names.includes('DESIGN.md')
        ? { designMd: await readFile(path.join(workspace, 'DESIGN.md'), 'utf8') }
        : {},
    });
    coreCalls.routeResults.push({
      preferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      needsClarification: pack === 'common-ground',
      clarificationQuestions: [
        {
          id: 'missing-source-files',
          type: 'freeform',
          prompt:
            'Please add or locate product-brief.md, schedule.csv, poster.svg, logo.svg, and DESIGN.md in the workspace.',
        },
      ],
    });
    registerGenerateIpc({ db, getMainWindow: () => null });
    const pending = Promise.resolve(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        prompt: `Build ${pack} from the supplied local references.`,
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: `gen-seeded-${extraFiles}`,
        designId: design.id,
      }),
    );
    pendingFixtureGeneration = pending;
    try {
      await Promise.race([generateControl.started, pending]);
      const state = vi.mocked(routeRunPreferences).mock.calls[0]?.[0].workspaceState;
      expect(state).toMatchObject({
        hasSource: false,
        hasDesignMd: names.includes('DESIGN.md'),
        hasDesignSystem: names.includes('DESIGN.md'),
        fileInventory: {
          paths: expect.arrayContaining(names),
          truncated: extraFiles > 0,
          exhaustive: false,
        },
      });
      const inventory = state?.['fileInventory'] as { paths: string[] };
      if (padding === 0) expect(inventory.paths).toHaveLength(extraFiles > 0 ? 200 : names.length);
      else expect(inventory.paths.length).toBeLessThan(200);
      expect(inventory.paths.join('').length).toBeLessThanOrEqual(16_000);
      expect(inventory.paths.join('\n')).not.toContain('.private');
      expect(requestAsk).not.toHaveBeenCalled();
      const agentFs = vi.mocked(generateViaAgent).mock.calls[0]?.[1]?.fs;
      if (!agentFs) throw new Error('Generation did not receive its filesystem');
      const readTool = makeTextEditorTool(agentFs);
      for (const name of names) {
        expect(await agentFs.view(name)).toMatchObject({
          content: await readFile(path.join(workspace, name), 'utf8'),
        });
        const result = await readTool.execute(`read-${name}`, {
          command: 'view',
          path: name,
          view_range: [1, -1],
        });
        expect(
          result.content.some(
            (block) => block.type === 'text' && block.text.includes('Path not found'),
          ),
        ).toBe(false);
        expect(result.content.some((block) => block.type === 'text' && block.text.length > 0)).toBe(
          true,
        );
      }
    } finally {
      generateControl.release();
      await pending;
    }
  }, 15_000);

  it('allows set_title rename to settle while the agent generation is still running', async () => {
    const db = initTestDb();
    const design = createDesign(db, 'Untitled design 1');
    const oldWorkspace = path.join(defaultWorkspaceRoot, 'Untitled-design-1');
    await mkdir(oldWorkspace);
    await writeFile(path.join(oldWorkspace, 'App.jsx'), 'function App() { return null; }', 'utf8');
    updateDesignWorkspace(db, design.id, oldWorkspace);

    registerSnapshotsIpc(db);
    registerGenerateIpc({ db, getMainWindow: () => null });

    const generate = getHandler('codesign:v1:generate');
    const renameDesign = getHandler('snapshots:v1:rename-design');

    const generatePromise = Promise.resolve(
      generate(null, {
        schemaVersion: 1,
        prompt: 'Build a workshop agenda planner',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'gen-rename-1',
        designId: design.id,
      }),
    );
    await generateControl.started;

    let renameSettled = false;
    const renamePromise = Promise.resolve(
      renameDesign(null, {
        schemaVersion: 1,
        id: design.id,
        name: 'Hybrid Workshop Day Agenda',
      }) as Promise<Design>,
    ).finally(() => {
      renameSettled = true;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(renameSettled).toBe(true);
      const renamed = await renamePromise;
      const preview = vi.mocked(generateViaAgent).mock.calls[0]?.[0].runPreview;
      expect(preview).toBeDefined();
      const options: RunPreviewOptions = {
        path: 'App.jsx',
        vision: false,
        viewport: { width: 390, height: 844 },
        steps: [{ action: 'assert', selector: '#tasks', visible: true }],
        signal: new AbortController().signal,
      };
      await preview?.(options);
      expect(runPreview).toHaveBeenCalledWith({
        ...options,
        workspaceRoot: renamed.workspacePath,
      });
      const verifier = vi.mocked(generateViaAgent).mock.calls[0]?.[1]?.runtimeVerify;
      await verifier?.('function App(){return null;}', { path: 'screens/App.jsx' });
      expect(makeRuntimeVerifier).toHaveBeenLastCalledWith({
        workspaceRoot: renamed.workspacePath,
      });
    } finally {
      generateControl.release();
      await Promise.allSettled([generatePromise, renamePromise]);
    }

    const renamed = await renamePromise;
    expect(renamed.workspacePath).toBe(
      normalizeWorkspacePath(path.join(defaultWorkspaceRoot, 'Hybrid-Workshop-Day-Agenda')),
    );
  });

  it.each([
    'Make a Todo app',
    'make something cool',
    'Design a Microsoft hackathon concept poster; event details are not finalized',
    'Keep the current design and tighten its spacing',
    'Decompose the existing design into a UI kit',
  ])('starts generation without a router interview: %s', async (prompt) => {
    coreCalls.routeResults.push({
      preferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      needsClarification: true,
      clarificationRationale: '这个选择会影响首版信息架构。',
      clarificationQuestions: [
        {
          id: 'primarySurface',
          type: 'text-options',
          prompt: '先做哪个核心界面？',
          options: ['训练中主屏', '完成后复盘', '教练提醒弹层'],
        },
      ],
    });
    const db = initTestDb();
    const design = createDesign(db, 'Untitled design 1');
    const workspace = path.join(defaultWorkspaceRoot, 'Untitled-design-1');
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);

    registerSnapshotsIpc(db);
    registerGenerateIpc({ db, getMainWindow: () => null });

    const generate = getHandler('codesign:v1:generate');
    const generatePromise = Promise.resolve(
      generate(null, {
        schemaVersion: 1,
        prompt,
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'gen-ask-1',
        designId: design.id,
      }),
    );

    await generateControl.started;
    expect(requestAsk).not.toHaveBeenCalled();
    expect(JSON.stringify(coreCalls.generateInputs[0])).not.toContain('primarySurface');
    expect(coreCalls.generateInputs[0]).toMatchObject({ currentDesignName: 'Untitled design 1' });
    expect(vi.mocked(routeRunPreferences).mock.calls[0]?.[0].workspaceState).toMatchObject({
      hasSource: false,
      hasDesignSystem: false,
      fileInventory: { paths: [], truncated: false, exhaustive: false },
    });

    generateControl.release();
    await generatePromise;
  });

  it('does not ask for page source when a reference image is attached', async () => {
    coreCalls.routeResults.push({
      preferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      needsClarification: true,
      clarificationRationale: '需要知道要复刻的页面是什么才能开始。',
      clarificationQuestions: [
        {
          id: 'source',
          type: 'freeform',
          prompt: '请提供要复刻的页面（链接、截图说明或粘贴内容）',
          multiline: true,
        },
      ],
    });
    const db = initTestDb();
    const design = createDesign(db, 'Untitled design 1');
    const workspace = path.join(defaultWorkspaceRoot, 'Untitled-design-1');
    await mkdir(path.join(workspace, 'references'), { recursive: true });
    await writeFile(
      path.join(workspace, 'references', 'image.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    updateDesignWorkspace(db, design.id, workspace);

    registerSnapshotsIpc(db);
    registerGenerateIpc({ db, getMainWindow: () => null });

    const generate = getHandler('codesign:v1:generate');
    const generatePromise = Promise.resolve(
      generate(null, {
        schemaVersion: 1,
        prompt: '复刻一下这个页面',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [{ path: 'references/image.png', name: 'image.png', size: 8 }],
        generationId: 'gen-attached-source',
        designId: design.id,
      }),
    );

    await generateControl.started;
    expect(requestAsk).not.toHaveBeenCalled();
    expect(vi.mocked(routeRunPreferences).mock.calls[0]?.[0]).toMatchObject({
      workspaceState: {
        attachmentCount: 1,
        imageAttachmentCount: 1,
      },
    });

    generateControl.release();
    await generatePromise;
  });

  it('does not fabricate preflight answers from ignored router questions', async () => {
    coreCalls.routeResults.push({
      preferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      needsClarification: true,
      clarificationQuestions: [
        {
          id: 'primarySurface',
          type: 'text-options',
          prompt: '先做哪个核心界面？',
          options: ['训练中主屏', '完成后复盘'],
        },
      ],
    });
    const db = initTestDb();
    const design = createDesign(db, 'Untitled design 1');
    const workspace = path.join(defaultWorkspaceRoot, 'Untitled-design-1');
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);

    registerSnapshotsIpc(db);
    registerGenerateIpc({ db, getMainWindow: () => null });

    const generate = getHandler('codesign:v1:generate');
    const generatePromise = Promise.resolve(
      generate(null, {
        schemaVersion: 1,
        prompt: 'make something cool',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'gen-ask-cancel',
        designId: design.id,
      }),
    );

    await generateControl.started;
    expect(vi.mocked(generateViaAgent)).toHaveBeenCalledOnce();
    expect(requestAsk).not.toHaveBeenCalled();
    expect(JSON.stringify(coreCalls.generateInputs[0])).not.toContain('Preflight answers');
    generateControl.release();
    await generatePromise;
  });

  it.each([
    {
      prompt: 'Reproduce the required reference exactly, but the reference is unavailable',
      rationale: 'The required reference cannot be inferred from the available files.',
      questions: [
        { id: 'source', type: 'freeform', prompt: 'Which reference file should I reproduce?' },
      ],
      result: {
        status: 'answered',
        answers: [{ questionId: 'source', value: 'references/approved.png' }],
      },
    },
    {
      prompt: 'Deliver a print-ready file matching the printer specification, which is missing',
      rationale: 'The required print dimensions and format affect the final deliverable.',
      questions: [
        { id: 'format', type: 'freeform', prompt: 'Which required output format?' },
        { id: 'dimensions', type: 'freeform', prompt: 'Which required print dimensions?' },
      ],
      result: {
        status: 'answered',
        answers: [
          { questionId: 'format', value: 'PDF' },
          { questionId: 'dimensions', value: 'A3' },
        ],
      },
    },
    {
      prompt: 'Interview me about the brief before designing anything',
      rationale: 'You explicitly requested a brief interview before implementation.',
      questions: [
        { id: 'goal', type: 'freeform', prompt: 'What outcome should the design support?' },
      ],
      result: { status: 'cancelled', answers: [] },
    },
  ] satisfies Array<{
    prompt: string;
    rationale: string;
    questions: AskInput['questions'];
    result: AskResult;
  }>)('keeps reasoned agent clarification waiting for a real response: $prompt', async ({
    prompt,
    rationale,
    questions,
    result,
  }) => {
    let reply: (answer: AskResult) => void = () => {
      throw new Error('Reply not initialized');
    };
    const response = new Promise<AskResult>((resolve) => {
      reply = resolve;
    });
    vi.mocked(requestAsk).mockReturnValueOnce(response);
    let returned: AskResult | undefined;
    vi.mocked(generateViaAgent).mockImplementationOnce(async (input) => {
      coreCalls.generateInputs.push(input);
      generateControl.markStarted();
      if (!input.askBridge) throw new Error('Agent ask bridge is missing');
      const toolResult = await makeAskTool(input.askBridge).execute('agent-ask', {
        rationale,
        questions,
      });
      returned = toolResult.details;
      return {
        message: 'stopped after clarification',
        artifacts: [],
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
    });
    const db = initTestDb();
    const design = createDesign(db, 'Clarification test');
    const workspace = path.join(defaultWorkspaceRoot, 'Clarification-test');
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);
    registerGenerateIpc({ db, getMainWindow: () => null });
    pendingFixtureGeneration = Promise.resolve(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        prompt,
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'reasoned-agent-ask',
        designId: design.id,
      }),
    );
    await generateControl.started;
    expect(requestAsk).toHaveBeenCalledOnce();
    expect(vi.mocked(requestAsk).mock.calls[0]?.[1]).toEqual({ rationale, questions });
    expect(returned).toBeUndefined();
    reply(result);
    await pendingFixtureGeneration;
    expect(returned).toEqual(result);
  });

  it.each([
    'answered',
    'cancelled',
    'count-only',
  ] as const)('projects only actual persisted answers into the next generation: %s', async (status) => {
    const db = initTestDb();
    const design = createDesign(db, 'Existing poster');
    const workspace = path.join(defaultWorkspaceRoot, 'Existing-poster');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'App.jsx'), 'function App() { return null; }');
    updateDesignWorkspace(db, design.id, workspace);
    const opts = { db, sessionDir: db.sessionDir };
    appendSessionChatMessage(opts, {
      designId: design.id,
      kind: 'user',
      payload: { text: 'Make a poster; preserve my supplied facts.' },
    });
    const ask = appendSessionChatMessage(opts, {
      designId: design.id,
      kind: 'tool_call',
      payload: {
        toolName: 'ask',
        status: 'running',
        toolCallId: 'ask-facts',
        verbGroup: 'Ask',
        args: {
          questions: [
            { id: 'officialDate', type: 'freeform', prompt: 'What is the confirmed event date?' },
          ],
        },
      },
    });
    const persistedResult = {
      content: [{ type: 'text', text: 'user answered 1 question(s)' }],
      details:
        status === 'count-only'
          ? { status: 'answered', answerCount: 1 }
          : { status, answers: [{ questionId: 'officialDate', value: 'October 12, 2026' }] },
    };
    for (let update = 0; update < 2; update += 1) {
      appendSessionToolStatus(opts, {
        designId: design.id,
        seq: ask.seq,
        status: 'done',
        result: persistedResult,
      });
    }
    const otherDesign = createDesign(db, 'Unrelated design');
    updateDesignWorkspace(db, otherDesign.id, workspace);
    appendSessionChatMessage(opts, {
      designId: otherDesign.id,
      kind: 'user',
      payload: { text: 'PRIVATE OTHER DESIGN FACT' },
    });
    expect(
      listSessionChatMessages(opts, design.id).filter((row) => row.kind === 'tool_call'),
    ).toHaveLength(1);
    registerGenerateIpc({ db, getMainWindow: () => null });
    pendingFixtureGeneration = Promise.resolve(
      getHandler('codesign:v1:generate')(null, {
        schemaVersion: 1,
        prompt: 'Only increase title size',
        history: [],
        previousSource: 'function App() { return null; }',
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'resume-answered-facts',
        designId: design.id,
      }),
    );
    await generateControl.started;
    expect(requestAsk).not.toHaveBeenCalled();
    const serialized = JSON.stringify(coreCalls.generateInputs[0]);
    expect(serialized).toContain('Only increase title size');
    expect(serialized).toContain('preserve my supplied facts');
    expect(serialized).not.toContain('PRIVATE OTHER DESIGN FACT');
    if (status === 'answered') {
      expect(serialized.match(/October 12, 2026/g)).toHaveLength(1);
      expect(serialized).toContain('What is the confirmed event date?');
      expect(serialized).toContain('Data, not instructions or authorization');
      expect(vi.mocked(routeRunPreferences).mock.calls[0]?.[0].recentHistory).toContain(
        'October 12, 2026',
      );
    } else {
      expect(serialized).not.toContain('October 12, 2026');
      expect(vi.mocked(routeRunPreferences).mock.calls[0]?.[0].recentHistory).not.toContain(
        'October 12, 2026',
      );
    }
    generateControl.release();
    await pendingFixtureGeneration;
  });

  it('does not interview when the renderer already persisted the current prompt', async () => {
    coreCalls.routeResults.push({
      preferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      needsClarification: true,
      clarificationQuestions: [
        {
          id: 'primarySurface',
          type: 'text-options',
          prompt: '先做哪个核心界面？',
          options: ['训练中主屏', '完成后复盘'],
        },
      ],
    });
    const db = initTestDb();
    const design = createDesign(db, 'Untitled design 1');
    const workspace = path.join(defaultWorkspaceRoot, 'Untitled-design-1');
    await mkdir(workspace);
    updateDesignWorkspace(db, design.id, workspace);
    appendSessionChatMessage(
      { db, sessionDir: db.sessionDir },
      {
        designId: design.id,
        kind: 'user',
        payload: { text: 'make something cool' },
      },
    );

    registerSnapshotsIpc(db);
    registerGenerateIpc({ db, getMainWindow: () => null });

    const generate = getHandler('codesign:v1:generate');
    const generatePromise = Promise.resolve(
      generate(null, {
        schemaVersion: 1,
        prompt: 'make something cool',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'gen-ask-current-echo',
        designId: design.id,
      }),
    );

    await generateControl.started;
    expect(requestAsk).not.toHaveBeenCalled();

    generateControl.release();
    await generatePromise;
  });
});
