/**
 * Tests for runCodexGenerate. Mocks the token store (per-test tmp path) and
 * the CodexClient via clientFactory injection so no network or filesystem
 * calls escape the suite.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexTokenStore } from '@open-codesign/providers/codex';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import type { ModelRef } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, getVersion: vi.fn(() => '0.0.0') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(async () => true) },
}));

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
    transports: {
      file: { resolvePathFn: null, maxSize: 0, format: '' },
      console: { level: 'info', format: '' },
    },
    errorHandler: { startCatching: vi.fn() },
    eventLogger: { startLogging: vi.fn() },
    info: vi.fn(),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(async () => true) },
}));

let tmpConfigDir: string;
vi.mock('./config', () => ({
  configDir: () => tmpConfigDir,
  writeConfig: vi.fn(async () => {}),
}));

vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: () => null,
  setCachedConfig: () => {},
}));

const MODEL: ModelRef = { provider: 'chatgpt-codex', modelId: 'gpt-5.3-codex' };

beforeEach(() => {
  tmpConfigDir = mkdtempSync(join(tmpdir(), 'codex-generate-'));
});

afterEach(async () => {
  const mod = await import('./codex-oauth-ipc');
  mod.__resetCodexTokenStoreForTests();
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

function makeStore(): CodexTokenStore {
  return new CodexTokenStore({ filePath: join(tmpConfigDir, 'codex-auth.json') });
}

describe('runCodexGenerate', () => {
  it('throws PROVIDER_AUTH_MISSING when no stored auth', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await expect(
      runCodexGenerate({
        prompt: 'hello',
        history: [],
        model: MODEL,
        attachments: [],
        referenceUrl: null,
        designSystem: null,
        tokenStore: store,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_AUTH_MISSING,
    });
  }, 15_000);

  it('returns artifacts when CodexClient.chat yields artifact text', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'acc-1',
      email: 'a@b.com',
      updatedAt: Date.now(),
    });

    const chat = vi.fn(async () => ({
      text: 'Here you go. <artifact identifier="a1" type="html" title="Hello"><html><body>hi</body></html></artifact>',
      raw: {},
    }));
    const clientFactory = vi.fn(
      () => ({ chat }) as unknown as import('@open-codesign/providers/codex').CodexClient,
    );

    const result = await runCodexGenerate({
      prompt: 'make a hero',
      history: [],
      model: MODEL,
      attachments: [],
      referenceUrl: null,
      designSystem: null,
      tokenStore: store,
      clientFactory,
    });

    expect(clientFactory).toHaveBeenCalledWith({ store, accountId: 'acc-1' });
    expect(chat).toHaveBeenCalledTimes(1);
    const chatArg = (chat.mock.calls as unknown as Array<Array<unknown>>)[0]?.[0] as {
      model: string;
      input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      instructions?: string;
    };
    expect(chatArg.model).toBe('gpt-5.3-codex');
    expect(chatArg.instructions).toBeTruthy();
    expect(chatArg.input[0]?.role).toBe('user');
    expect(chatArg.input[0]?.content[0]?.type).toBe('input_text');
    expect(chatArg.input.at(-1)?.role).toBe('user');

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.content).toContain('<html>');
    expect(result.artifacts[0]?.id).toBe('a1');
    expect(result.message).toBe('Here you go.');
    expect(result.issues).toEqual([]);
  });

  it('forwards image attachments as Responses input_image parts', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'acc-1',
      email: 'a@b.com',
      updatedAt: Date.now(),
    });

    const chat = vi.fn(async () => ({ text: 'ok', raw: {} }));
    const clientFactory = vi.fn(
      () => ({ chat }) as unknown as import('@open-codesign/providers/codex').CodexClient,
    );

    await runCodexGenerate({
      prompt: 'match this screenshot',
      history: [],
      model: MODEL,
      attachments: [
        {
          name: 'shot.png',
          path: 'C:/tmp/shot.png',
          note: 'Attached as an image input.',
          mediaType: 'image/png',
          imageDataUrl: 'data:image/png;base64,AAAA',
        },
      ],
      referenceUrl: null,
      designSystem: null,
      tokenStore: store,
      clientFactory,
    });

    const chatArg = (chat.mock.calls as unknown as Array<Array<unknown>>)[0]?.[0] as {
      input: Array<{
        role: string;
        content: Array<{ type: string; text?: string; image_url?: string; detail?: string }>;
      }>;
    };
    const userMessage = chatArg.input.at(-1);
    expect(userMessage?.role).toBe('user');
    expect(userMessage?.content.some((part) => part.type === 'input_image')).toBe(true);
    expect(userMessage?.content.find((part) => part.type === 'input_image')).toMatchObject({
      type: 'input_image',
      image_url: 'data:image/png;base64,AAAA',
      detail: 'auto',
    });
  });

  it('rejects image attachments whose combined size exceeds the codex limit', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'acc-1',
      email: 'a@b.com',
      updatedAt: Date.now(),
    });

    const imagePayload = `data:image/png;base64,${'A'.repeat(2_700_000)}`;

    await expect(
      runCodexGenerate({
        prompt: 'match these screenshots',
        history: [],
        model: MODEL,
        attachments: [
          {
            name: 'shot-1.png',
            path: 'C:/tmp/shot-1.png',
            mediaType: 'image/png',
            imageDataUrl: imagePayload,
          },
          {
            name: 'shot-2.png',
            path: 'C:/tmp/shot-2.png',
            mediaType: 'image/png',
            imageDataUrl: imagePayload,
          },
        ],
        referenceUrl: null,
        designSystem: null,
        tokenStore: store,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.ATTACHMENT_TOO_LARGE,
    });
  });

  it('allows plain-text replies for non-design prompts', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'acc-1',
      email: 'a@b.com',
      updatedAt: Date.now(),
    });

    const chat = vi.fn(async () => ({
      text: '我是 gpt-5.4，目前在 open-codesign 里作为设计助手运行。',
      raw: {},
    }));
    const clientFactory = vi.fn(
      () => ({ chat }) as unknown as import('@open-codesign/providers/codex').CodexClient,
    );

    const result = await runCodexGenerate({
      prompt: '你是什么模型',
      history: [],
      model: MODEL,
      attachments: [],
      referenceUrl: null,
      designSystem: null,
      tokenStore: store,
      clientFactory,
    });

    expect(result.artifacts).toEqual([]);
    expect(result.message).toContain('gpt-5.4');
    expect(result.issues).toEqual([]);
  });

  it('propagates errors from CodexClient.chat', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: 'acc-1',
      email: null,
      updatedAt: Date.now(),
    });

    const chat = vi.fn(async () => {
      throw new Error('Codex chat failed: 500');
    });
    const clientFactory = () =>
      ({ chat }) as unknown as import('@open-codesign/providers/codex').CodexClient;

    await expect(
      runCodexGenerate({
        prompt: 'x',
        history: [],
        model: MODEL,
        attachments: [],
        referenceUrl: null,
        designSystem: null,
        tokenStore: store,
        clientFactory,
      }),
    ).rejects.toThrow(/Codex chat failed/);
  });

  it('throws when stored auth has null accountId', async () => {
    const { runCodexGenerate } = await import('./codex-generate');
    const store = makeStore();
    await store.write({
      schemaVersion: 1,
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      expiresAt: Date.now() + 3_600_000,
      accountId: null,
      email: null,
      updatedAt: Date.now(),
    });

    const err = await runCodexGenerate({
      prompt: 'x',
      history: [],
      model: MODEL,
      attachments: [],
      referenceUrl: null,
      designSystem: null,
      tokenStore: store,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodesignError);
    expect((err as CodesignError).code).toBe(ERROR_CODES.PROVIDER_AUTH_MISSING);
  });
});
