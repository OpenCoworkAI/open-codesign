import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ResolveActiveApiKeyDeps, ResolveCredentialForProviderDeps } from './resolve-api-key';
import { resolveActiveApiKey, resolveCredentialForProvider } from './resolve-api-key';

function makeDeps(overrides: Partial<ResolveActiveApiKeyDeps> = {}): ResolveActiveApiKeyDeps {
  return {
    getCodexAccessToken: vi.fn().mockResolvedValue('oauth-token'),
    getApiKeyForProvider: vi.fn().mockReturnValue('stored-key'),
    ...overrides,
  };
}

describe('resolveActiveApiKey', () => {
  it('codex: returns the OAuth access token from the token store', async () => {
    const deps = makeDeps();
    const token = await resolveActiveApiKey('chatgpt-codex', deps);
    expect(token).toBe('oauth-token');
    expect(deps.getCodexAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it('codex: wraps token-store failure in CodesignError(PROVIDER_AUTH_MISSING)', async () => {
    const deps = makeDeps({
      getCodexAccessToken: vi.fn().mockRejectedValue(new Error('ChatGPT 订阅未登录')),
    });
    await expect(resolveActiveApiKey('chatgpt-codex', deps)).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'PROVIDER_AUTH_MISSING',
      message: expect.stringContaining('订阅未登录'),
    });
  });

  it('codex: preserves the original error as cause for diagnostics', async () => {
    const underlying = new Error('refresh gave 400');
    const deps = makeDeps({
      getCodexAccessToken: vi.fn().mockRejectedValue(underlying),
    });
    try {
      await resolveActiveApiKey('chatgpt-codex', deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).cause).toBe(underlying);
    }
  });

  it('codex: handles non-Error rejections with a generic recovery message', async () => {
    const deps = makeDeps({
      getCodexAccessToken: vi.fn().mockRejectedValue('broken string value'),
    });
    await expect(resolveActiveApiKey('chatgpt-codex', deps)).rejects.toMatchObject({
      name: 'CodesignError',
      code: 'PROVIDER_AUTH_MISSING',
      message: 'ChatGPT subscription not signed in',
    });
  });

  it('non-codex: returns the stored API key', async () => {
    const deps = makeDeps();
    const key = await resolveActiveApiKey('anthropic', deps);
    expect(key).toBe('stored-key');
    expect(deps.getApiKeyForProvider).toHaveBeenCalledWith('anthropic');
    expect(deps.getCodexAccessToken).not.toHaveBeenCalled();
  });

  it('non-codex: wraps key-missing error in CodesignError(PROVIDER_AUTH_MISSING) with cause', async () => {
    const underlying = new Error('no key stored');
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw underlying;
      }),
    });
    // Keyless support is the caller's job: IPC handlers use the explicit
    // credential resolver before reading key storage. This helper never
    // silently drops the error.
    try {
      await resolveActiveApiKey('custom-proxy', deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('PROVIDER_AUTH_MISSING');
      expect((err as CodesignError).message).toBe('no key stored');
      expect((err as CodesignError).cause).toBe(underlying);
    }
  });

  it('non-codex: passes through pre-existing CodesignError without re-wrapping', async () => {
    const original = new CodesignError('custom code', 'PROVIDER_KEY_MISSING');
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    // If the underlying helper already threw a structured error with its own
    // code (e.g. PROVIDER_KEY_MISSING vs the keychain-read failures above),
    // we must not clobber it — let callers observe the original code.
    await expect(resolveActiveApiKey('anthropic', deps)).rejects.toBe(original);
  });

  it('non-codex: wraps non-Error rejections with a generic diagnostic message', async () => {
    const deps = makeDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw 'broken string throw';
      }),
    });
    try {
      await resolveActiveApiKey('some-proxy', deps);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('PROVIDER_AUTH_MISSING');
      expect((err as CodesignError).message).toContain('some-proxy');
    }
  });
});

describe('resolveCredentialForProvider', () => {
  function keylessDeps(
    overrides: Partial<ResolveCredentialForProviderDeps> = {},
  ): ResolveCredentialForProviderDeps {
    return {
      getCodexAccessToken: vi.fn().mockResolvedValue('oauth-token'),
      getApiKeyForProvider: vi.fn().mockReturnValue('stored-key'),
      hasApiKeyForProvider: vi.fn().mockReturnValue(true),
      ...overrides,
    };
  }

  it('keyless provider without a stored secret returns an empty bearer without reading key storage', async () => {
    const deps = keylessDeps({
      hasApiKeyForProvider: vi.fn().mockReturnValue(false),
    });
    await expect(resolveCredentialForProvider('ollama', true, deps)).resolves.toBe('');
    expect(deps.getApiKeyForProvider).not.toHaveBeenCalled();
  });

  it('keyless provider with a stored secret still surfaces secret read failures', async () => {
    const original = new Error('keychain decrypt failed');
    const deps = keylessDeps({
      hasApiKeyForProvider: vi.fn().mockReturnValue(true),
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    await expect(resolveCredentialForProvider('custom-proxy', true, deps)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_MISSING',
      cause: original,
    });
  });

  it('keyless: propagates unrelated CodesignError codes verbatim', async () => {
    const original = new CodesignError('downstream blew up', 'PROVIDER_ERROR');
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    await expect(resolveCredentialForProvider('ollama', true, deps)).rejects.toBe(original);
  });

  it('non-keyless: re-throws PROVIDER_KEY_MISSING so the user sees "add your key"', async () => {
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw new CodesignError('no secret stored', 'PROVIDER_KEY_MISSING');
      }),
    });
    await expect(resolveCredentialForProvider('anthropic', false, deps)).rejects.toMatchObject({
      code: 'PROVIDER_KEY_MISSING',
    });
  });

  it('codex: NEVER swallowed even with allowKeyless=true (the sign-in prompt must surface)', async () => {
    const deps = keylessDeps({
      getCodexAccessToken: vi.fn().mockRejectedValue(new Error('not signed in')),
    });
    // Somebody marking the codex ProviderEntry as keyless by config-toml
    // hand-edit must not suppress the auth-required affordance.
    await expect(resolveCredentialForProvider('chatgpt-codex', true, deps)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_MISSING',
    });
  });

  it('happy path: returns the stored key when no error is thrown', async () => {
    const deps = keylessDeps();
    await expect(resolveCredentialForProvider('anthropic', false, deps)).resolves.toBe(
      'stored-key',
    );
  });
});
