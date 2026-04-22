import { CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import { resolveActiveApiKey, resolveApiKeyWithKeylessFallback } from './resolve-api-key';

function makeDeps(overrides: Partial<Parameters<typeof resolveActiveApiKey>[1]> = {}) {
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

  it('codex: handles non-Error rejections with a generic fallback message', async () => {
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
    // Keyless support is the caller's job: the IPC handler swallows this
    // throw only when `entry.requiresApiKey === false`. The helper itself
    // never silently drops the error.
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

describe('resolveApiKeyWithKeylessFallback', () => {
  function keylessDeps(overrides: Partial<Parameters<typeof resolveActiveApiKey>[1]> = {}) {
    return {
      getCodexAccessToken: vi.fn().mockResolvedValue('oauth-token'),
      getApiKeyForProvider: vi.fn().mockReturnValue('stored-key'),
      ...overrides,
    };
  }

  it('keyless Ollama (PROVIDER_KEY_MISSING): swallows and returns empty', async () => {
    // This is the regression the round-6 bot review caught: Ollama's
    // `getApiKeyForProvider` throws CodesignError(PROVIDER_KEY_MISSING) (not
    // PROVIDER_AUTH_MISSING), and the resolver passes existing CodesignErrors
    // through untouched. The earlier keyless wrapper only swallowed
    // PROVIDER_AUTH_MISSING, so Ollama would hard-fail despite
    // `requiresApiKey: false`.
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw new CodesignError('no secret stored', 'PROVIDER_KEY_MISSING');
      }),
    });
    await expect(resolveApiKeyWithKeylessFallback('ollama', true, deps)).resolves.toBe('');
  });

  it('keyless custom proxy (PROVIDER_AUTH_MISSING): swallows and returns empty', async () => {
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw new Error('keychain decrypt failed');
      }),
    });
    // Non-CodesignError failures get wrapped as PROVIDER_AUTH_MISSING by
    // `resolveActiveApiKey`, which the keyless wrapper also swallows.
    await expect(resolveApiKeyWithKeylessFallback('custom-proxy', true, deps)).resolves.toBe('');
  });

  it('keyless: propagates unrelated CodesignError codes verbatim', async () => {
    const original = new CodesignError('downstream blew up', 'PROVIDER_ERROR');
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw original;
      }),
    });
    // Only the two missing-credential codes count as keyless-swallowable.
    await expect(resolveApiKeyWithKeylessFallback('ollama', true, deps)).rejects.toBe(original);
  });

  it('non-keyless: re-throws PROVIDER_KEY_MISSING so the user sees "add your key"', async () => {
    const deps = keylessDeps({
      getApiKeyForProvider: vi.fn().mockImplementation(() => {
        throw new CodesignError('no secret stored', 'PROVIDER_KEY_MISSING');
      }),
    });
    await expect(resolveApiKeyWithKeylessFallback('anthropic', false, deps)).rejects.toMatchObject({
      code: 'PROVIDER_KEY_MISSING',
    });
  });

  it('codex: NEVER swallowed even with allowKeyless=true (the sign-in prompt must surface)', async () => {
    const deps = keylessDeps({
      getCodexAccessToken: vi.fn().mockRejectedValue(new Error('not signed in')),
    });
    // Somebody marking the codex ProviderEntry as keyless by config-toml
    // hand-edit must not suppress the auth-required affordance.
    await expect(
      resolveApiKeyWithKeylessFallback('chatgpt-codex', true, deps),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH_MISSING' });
  });

  it('happy path: returns the stored key when no error is thrown', async () => {
    const deps = keylessDeps();
    await expect(resolveApiKeyWithKeylessFallback('anthropic', false, deps)).resolves.toBe(
      'stored-key',
    );
  });
});
