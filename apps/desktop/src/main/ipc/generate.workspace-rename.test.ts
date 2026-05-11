import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, raw: unknown) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());
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

vi.mock('../electron-runtime', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'open-codesign-generate-rename-tests')),
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
    buildDesignContextPack: vi.fn(() => ({
      history: [],
      contextSections: [],
      trace: {
        briefChars: 0,
        historyChars: 0,
        selectedMessages: 0,
        droppedMessages: 0,
        contextBudgetChars: 0,
        sessionContextChars: 0,
      },
    })),
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

import { generateViaAgent, routeRunPreferences } from '@open-codesign/core';
import { requestAsk } from '../ask-ipc';
import { appendSessionChatMessage } from '../session-chat';
import { createDesign, initInMemoryDb, updateDesignWorkspace } from '../snapshots-db';
import { registerSnapshotsIpc } from '../snapshots-ipc';
import { normalizeWorkspacePath } from '../workspace-path';
import { registerGenerateIpc } from './generate';

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler;
}

describe('generate IPC workspace rename coordination', () => {
  const documentsRoot = path.join(os.tmpdir(), 'open-codesign-generate-rename-tests');
  const defaultWorkspaceRoot = path.join(documentsRoot, 'CoDesign');

  function initTestDb() {
    return {
      ...initInMemoryDb(),
      dataDir: path.join(documentsRoot, 'data'),
      sessionDir: path.join(documentsRoot, 'sessions'),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();
    coreCalls.generateInputs.length = 0;
    coreCalls.routeResults.length = 0;
    generateControl.reset();
    await rm(documentsRoot, { recursive: true, force: true });
    await mkdir(defaultWorkspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    generateControl.release();
    await rm(documentsRoot, { recursive: true, force: true });
  });

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
    } finally {
      generateControl.release();
      await Promise.allSettled([generatePromise, renamePromise]);
    }

    const renamed = await renamePromise;
    expect(renamed.workspacePath).toBe(
      normalizeWorkspacePath(path.join(defaultWorkspaceRoot, 'Hybrid-Workshop-Day-Agenda')),
    );
  });

  it('runs semantic router preflight ask before generateViaAgent', async () => {
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
        prompt: 'make something cool',
        history: [],
        model: { provider: 'mock-provider', modelId: 'mock-model' },
        attachments: [],
        generationId: 'gen-ask-1',
        designId: design.id,
      }),
    );

    await generateControl.started;
    const askOrder = vi.mocked(requestAsk).mock.invocationCallOrder[0] ?? 0;
    const generateOrder = vi.mocked(generateViaAgent).mock.invocationCallOrder[0] ?? 0;
    expect(askOrder).toBeGreaterThan(0);
    expect(askOrder).toBeLessThan(generateOrder);
    expect(vi.mocked(requestAsk).mock.calls[0]?.[1]).toMatchObject({
      rationale: '这个选择会影响首版信息架构。',
      questions: [
        {
          id: 'primarySurface',
          prompt: '先做哪个核心界面？',
          options: ['训练中主屏', '完成后复盘', '教练提醒弹层'],
        },
      ],
    });
    expect(coreCalls.generateInputs[0]).toMatchObject({ currentDesignName: 'Untitled design 1' });

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

  it('continues generation when semantic preflight ask is cancelled', async () => {
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
    vi.mocked(requestAsk).mockResolvedValueOnce({ status: 'cancelled', answers: [] });
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
    generateControl.release();
    await generatePromise;
  });

  it('still runs semantic preflight when the renderer already persisted the current prompt', async () => {
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
    expect(vi.mocked(requestAsk)).toHaveBeenCalledOnce();
    expect(vi.mocked(requestAsk).mock.calls[0]?.[1].questions.map((q) => q.id)).toEqual([
      'primarySurface',
    ]);

    generateControl.release();
    await generatePromise;
  });
});
