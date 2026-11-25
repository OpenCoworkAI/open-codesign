import { CodesignError, type Config, ERROR_CODES, hydrateConfig } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: null as Config | null,
  inheritedKey: vi.fn<(provider: string) => string>(),
  decrypt: vi.fn<(ciphertext: string) => string>(),
  token: vi.fn<() => Promise<string>>(),
  writeConfig: vi.fn(),
  setCachedConfig: vi.fn(),
  handle: vi.fn(),
}));
vi.mock('./onboarding-ipc', () => ({
  getCachedConfig: () => state.config,
  getApiKeyForProvider: state.inheritedKey,
  setCachedConfig: state.setCachedConfig,
}));
vi.mock('./config', () => ({ writeConfig: state.writeConfig }));
vi.mock('./keychain', () => ({ decryptSecret: state.decrypt, buildSecretRef: vi.fn() }));
vi.mock('./codex-oauth-ipc', () => ({
  getCodexTokenStore: () => ({ getValidAccessToken: state.token }),
}));
vi.mock('./electron-runtime', () => ({ ipcMain: { handle: state.handle } }));
vi.mock('./logger', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { registerImageGenerationSettingsIpc } from './image-generation-settings';
import { testImageGenerationProvider } from './image-generation-test';

const PNG = 'iVBORw0KGgo=';
const fetchMock = vi.fn<typeof fetch>();

function config(provider: 'openai' | 'openrouter' | 'chatgpt-codex' = 'openai'): Config {
  return hydrateConfig({
    version: 3,
    activeProvider: 'openai',
    activeModel: 'text-model',
    secrets: {},
    providers: {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        builtin: true,
        wire: 'openai-chat',
        baseUrl: 'https://saved-gateway.example/v1',
        defaultModel: 'text-model',
      },
    },
    imageGeneration: {
      schemaVersion: 1,
      enabled: false,
      provider,
      credentialMode: 'inherit',
      model: 'saved-image-model',
      quality: 'medium',
      size: '1024x1024',
      outputFormat: 'png',
    },
  });
}

function imageResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
}

function firstRequest() {
  const request = fetchMock.mock.calls[0];
  if (!request) throw new Error('Expected an image HTTP request');
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.config = config();
  state.inheritedKey.mockReturnValue('fixture-inherited-key');
  state.decrypt.mockReturnValue('fixture-custom-key');
  state.token.mockResolvedValue(
    [
      'header',
      Buffer.from(
        JSON.stringify({
          'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' },
        }),
      ).toString('base64url'),
      'signature',
    ].join('.'),
  );
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(imageResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saved-settings image generation test', () => {
  it('invokes the actual OpenAI image route with saved settings without enabling or writing configuration', async () => {
    const before = structuredClone(state.config);
    const result = await testImageGenerationProvider();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = firstRequest();
    expect(url).toBe('https://saved-gateway.example/v1/images/generations');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-inherited-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'saved-image-model',
      n: 1,
      quality: 'medium',
      size: '1024x1024',
      output_format: 'png',
    });
    expect(state.inheritedKey).toHaveBeenCalledWith('openai');
    expect(result).toEqual({
      provider: 'openai',
      model: 'saved-image-model',
      mimeType: 'image/png',
    });
    expect(JSON.stringify(result)).not.toContain(PNG);
    expect(JSON.stringify(result)).not.toContain('fixture-inherited-key');
    expect(state.config).toEqual(before);
    expect(state.writeConfig).not.toHaveBeenCalled();
    expect(state.setCachedConfig).not.toHaveBeenCalled();
  });

  it('uses the stored custom OpenRouter credential and actual image modalities', async () => {
    state.config = config('openrouter');
    const saved = state.config.imageGeneration;
    if (!saved) throw new Error('Missing fixture image settings');
    state.config.imageGeneration = {
      ...saved,
      credentialMode: 'custom',
      apiKey: { ciphertext: 'safe:stored-fixture', mask: '***' },
      baseUrl: 'https://router.example/api/v1',
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(testImageGenerationProvider()).resolves.toMatchObject({
      provider: 'openrouter',
      mimeType: 'image/png',
    });
    const [url, init] = firstRequest();
    expect(url).toBe('https://router.example/api/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-custom-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      modalities: ['image', 'text'],
      stream: false,
    });
    expect(state.decrypt).toHaveBeenCalledExactlyOnceWith('safe:stored-fixture');
    expect(state.inheritedKey).not.toHaveBeenCalled();
  });

  it('uses the production Codex image stream with the refreshed saved-account credential', async () => {
    state.config = config('chatgpt-codex');
    fetchMock.mockResolvedValueOnce(
      new Response(
        [
          `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call', result: PNG } })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    await expect(testImageGenerationProvider()).resolves.toMatchObject({
      provider: 'chatgpt-codex',
      mimeType: 'image/png',
    });
    const [url, init] = firstRequest();
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(new Headers(init?.headers).get('chatgpt-account-id')).toBe('fixture-account');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${await state.token.mock.results[0]?.value}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: true,
      store: false,
      tool_choice: { type: 'image_generation' },
      tools: [expect.objectContaining({ type: 'image_generation' })],
    });
    expect(state.token).toHaveBeenCalledOnce();
    expect(state.inheritedKey).not.toHaveBeenCalled();
    expect(state.decrypt).not.toHaveBeenCalled();
  });

  it('inherits the selected image provider key instead of the active text provider key', async () => {
    state.config = config('openrouter');
    state.inheritedKey.mockImplementation((provider) =>
      provider === 'openrouter' ? 'fixture-router-key' : 'fixture-text-key',
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await testImageGenerationProvider();
    expect(state.inheritedKey).toHaveBeenCalledExactlyOnceWith('openrouter');
    expect(new Headers(firstRequest()[1]?.headers).get('authorization')).toBe(
      'Bearer fixture-router-key',
    );
  });

  it('does not accept a text-only or model-listing response as image capability', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'text-model' }] }), { status: 200 }),
    );
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
    });
  });

  it('deduplicates simultaneous requests so they cannot generate multiple billable images', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const first = testImageGenerationProvider();
    const second = testImageGenerationProvider();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    resolveFetch(imageResponse());
    await expect(first).resolves.toHaveProperty('mimeType', 'image/png');
    await second;
    await testImageGenerationProvider();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redacts the saved credential from errors and allows a fresh retry after failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Rejected fixture-inherited-key fixture-inherited-key', { status: 401 }),
    );
    try {
      await testImageGenerationProvider();
      throw new Error('Expected a rejected image test');
    } catch (error) {
      expect(error).toMatchObject({ code: ERROR_CODES.PROVIDER_ERROR });
      expect((error as Error).message).toContain('HTTP 401');
      expect((error as Error).message).not.toContain('fixture-inherited-key');
      expect((error as Error).message).toContain('***REDACTED***');
      expect((error as Error).cause).toBeUndefined();
    }
    await expect(testImageGenerationProvider()).resolves.toHaveProperty('mimeType', 'image/png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps missing-key errors readable when the resolver returns an empty key', async () => {
    state.inheritedKey.mockReturnValue('');
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_AUTH_MISSING,
      message: 'Missing image generation API key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redacts a long credential even when the provider truncates its diagnostic body', async () => {
    const key = `fixture_long_key_${'z'.repeat(900)}`;
    state.inheritedKey.mockReturnValue(key);
    fetchMock.mockResolvedValueOnce(new Response(`Rejected token ${key}`, { status: 403 }));
    try {
      await testImageGenerationProvider();
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: ERROR_CODES.PROVIDER_ERROR });
      expect((error as Error).message).toContain('HTTP 403');
      expect((error as Error).message).not.toContain(key.slice(0, 32));
      expect((error as Error).message).not.toContain('z'.repeat(32));
      expect((error as Error).message).toContain('***REDACTED***');
    }
  });

  it('uses a 120-second abort signal and reports a bounded timeout without retrying generation', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('fixture abort')), {
            once: true,
          });
        }),
    );
    const pending = testImageGenerationProvider();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledExactlyOnceWith(120_000);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ABORTED,
      message: expect.stringContaining('120 seconds'),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    hydrateConfig({
      version: 3,
      activeProvider: 'openai',
      activeModel: 'text-model',
      providers: {},
      secrets: {},
    }),
  ])('refuses missing saved image settings without a network call', async (saved) => {
    state.config = saved;
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.CONFIG_MISSING,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves missing stored-credential errors without using another provider key', async () => {
    state.inheritedKey.mockImplementation(() => {
      throw new CodesignError('Missing provider key', ERROR_CODES.PROVIDER_KEY_MISSING);
    });
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_KEY_MISSING,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.token).not.toHaveBeenCalled();
  });

  it('does not fall back to an inherited key when a custom image key is missing', async () => {
    state.config = config();
    const saved = state.config.imageGeneration;
    if (!saved) throw new Error('Missing fixture image settings');
    state.config.imageGeneration = { ...saved, credentialMode: 'custom' };
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_KEY_MISSING,
    });
    expect(state.inheritedKey).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not substitute a text API key when the configured ChatGPT account is signed out', async () => {
    state.config = config('chatgpt-codex');
    state.token.mockRejectedValueOnce(
      new CodesignError('ChatGPT account is signed out', ERROR_CODES.CODEX_TOKEN_NOT_LOGGED_IN),
    );
    await expect(testImageGenerationProvider()).rejects.toMatchObject({
      code: ERROR_CODES.CODEX_TOKEN_NOT_LOGGED_IN,
    });
    expect(state.inheritedKey).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers an explicit no-draft IPC endpoint that runs the image test', async () => {
    registerImageGenerationSettingsIpc();
    const registration = state.handle.mock.calls.find(
      ([channel]) => channel === 'image-generation:v1:test',
    );
    expect(registration).toBeDefined();
    if (!registration) throw new Error('Missing image test handler');
    await expect((registration[1] as () => Promise<unknown>)()).resolves.toHaveProperty(
      'mimeType',
      'image/png',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
