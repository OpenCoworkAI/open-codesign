import { hydrateConfig } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ token: vi.fn(), complete: vi.fn() }));
vi.mock('./electron-runtime', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('./codex-oauth-ipc', () => ({
  getCodexTokenStore: () => ({ getValidAccessToken: state.token }),
}));
// Mock pi's public boundary, never a provider SDK or a model endpoint.
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: () => undefined,
  completeSimple: state.complete,
}));

import { handleConnectionV1TestProvider } from './connection-ipc';
import { setCachedConfig } from './onboarding/config-cache';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function seed() {
  setCachedConfig(
    hydrateConfig({
      version: 3,
      activeProvider: 'chatgpt-codex',
      activeModel: 'gpt-5.5',
      providers: {
        'chatgpt-codex': {
          id: 'chatgpt-codex',
          name: 'ChatGPT',
          builtin: false,
          wire: 'openai-codex-responses',
          baseUrl: 'https://chatgpt.com/backend-api',
          defaultModel: 'gpt-5.5',
          reasoningLevel: 'low',
        },
      },
      secrets: {},
    }),
  );
  state.token.mockResolvedValue('fixture-refreshed-oauth');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No network allowed in this pi-boundary fixture');
    }),
  );
}
function seedBounded() {
  seed();
  setCachedConfig(
    hydrateConfig({
      version: 3,
      activeProvider: 'fixture-local',
      activeModel: 'fixture-model',
      providers: {
        'fixture-local': {
          id: 'fixture-local',
          name: 'Fixture local',
          builtin: false,
          wire: 'openai-chat',
          baseUrl: 'http://127.0.0.1:12345/v1',
          defaultModel: 'fixture-model',
          requiresApiKey: false,
          capabilities: { modelDiscoveryMode: 'manual' },
        },
      },
      secrets: {},
    }),
  );
}
describe('Codex invocation parity at the pi boundary', () => {
  it('distinguishes an accepted invocation limited by the tiny test budget from a rejected invocation', async () => {
    seedBounded();
    state.complete.mockResolvedValue({
      content: [],
      stopReason: 'length',
      usage: { input: 1, output: 16, cost: { total: 0 } },
    });
    expect(await handleConnectionV1TestProvider('fixture-local')).toMatchObject({
      ok: true,
      invokeValidation: 'output-limit',
      invokeParity: 'aligned',
    });
  });
  it('aborts a hanging invocation within the bounded timeout without retries', async () => {
    seedBounded();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    state.complete.mockImplementationOnce(
      (_model, _context, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const pending = handleConnectionV1TestProvider('fixture-local');
    await vi.waitFor(() => expect(state.complete).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, message: 'Connection invocation timed out.' });
    expect(timeout).toHaveBeenCalledWith(10000);
    timeout.mockRestore();
  });
  it('does not send unbounded Codex inference or mark a refreshed token invoke-ready', async () => {
    seed();
    state.complete.mockResolvedValue({
      content: [{ type: 'text', text: 'OK' }],
      stopReason: 'stop',
      usage: { input: 1, output: 1, cost: { total: 0 } },
    });
    expect(await handleConnectionV1TestProvider('chatgpt-codex')).toMatchObject({
      ok: false,
      code: 'INVOKE_UNVERIFIED',
      invokeParity: 'unverified',
      validationUnavailableReason: 'output-budget-unsupported',
    });
    expect(state.token).toHaveBeenCalledOnce();
    expect(state.complete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports a bounded invocation rejection instead of marking the route ready', async () => {
    seedBounded();
    state.complete.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: '401 fixture invocation rejected',
    });
    const result = await handleConnectionV1TestProvider('fixture-local');
    expect(result).toMatchObject({ ok: false, code: '401', reasonCategory: 'auth' });
    expect(state.complete).toHaveBeenCalledOnce();
  });
});
