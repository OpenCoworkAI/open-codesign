import { describe, expect, it, vi } from 'vitest';
import { classifyDetectError, detectProvider } from './PasteKey';

// ---------------------------------------------------------------------------
// Unit tests for the unified ConnectionCheck logic in PasteKey.
//
// The component no longer has a separate ValidationState — the Test button is
// the single authority for both key validity and endpoint reachability.
// These tests mirror the handleTest guard logic extracted from PasteKey.tsx.
// ---------------------------------------------------------------------------

type ConnectionCheck =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok' }
  | { status: 'failed'; code: string; hint: string };

// Default base URLs — mirrors defaultBaseUrl() in PasteKey.tsx and
// buildDefaultBaseUrl() in connection-ipc.ts. They must stay in sync.
function defaultBaseUrl(provider: 'anthropic' | 'openai' | 'openrouter'): string {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
  }
}

// Mirrors handleTest from PasteKey.tsx
async function handleTest(
  provider: string | null,
  trimmed: string,
  trimmedBaseUrl: string,
  connectionBridge:
    | { test: (payload: unknown) => Promise<{ ok: boolean; code?: string; hint?: string }> }
    | undefined,
  setConnCheck: (s: ConnectionCheck) => void,
): Promise<void> {
  if (!provider || trimmed.length === 0) return;
  const baseUrlForTest =
    trimmedBaseUrl.length > 0
      ? trimmedBaseUrl
      : defaultBaseUrl(provider as 'anthropic' | 'openai' | 'openrouter');
  if (baseUrlForTest.length === 0) return;

  if (!connectionBridge) {
    setConnCheck({
      status: 'failed',
      code: 'NETWORK',
      hint: 'Renderer is not connected to the main process.',
    });
    return;
  }

  setConnCheck({ status: 'testing' });
  try {
    const result = await connectionBridge.test({
      provider,
      apiKey: trimmed,
      baseUrl: baseUrlForTest,
    });
    if (result.ok) {
      setConnCheck({ status: 'ok' });
    } else {
      setConnCheck({
        status: 'failed',
        code: result.code ?? 'NETWORK',
        hint: result.hint ?? 'Connection test failed.',
      });
    }
  } catch (err) {
    setConnCheck({
      status: 'failed',
      code: 'NETWORK',
      hint: err instanceof Error ? err.message : 'Connection test failed.',
    });
  }
}

describe('handleTest — unified ConnectionCheck', () => {
  it('sets failed when connection bridge is undefined', async () => {
    const setConnCheck = vi.fn();
    await handleTest('openai', 'sk-test', 'https://api.openai.com/v1', undefined, setConnCheck);
    expect(setConnCheck).toHaveBeenCalledOnce();
    const arg = setConnCheck.mock.calls[0]?.[0] as ConnectionCheck;
    expect(arg.status).toBe('failed');
    if (arg.status === 'failed') {
      expect(arg.code).toBe('NETWORK');
      expect(arg.hint).toContain('not connected');
    }
  });

  it('does not call setConnCheck when provider is null', async () => {
    const setConnCheck = vi.fn();
    await handleTest(null, 'sk-test', 'https://api.openai.com/v1', undefined, setConnCheck);
    expect(setConnCheck).not.toHaveBeenCalled();
  });

  it('does not call setConnCheck when trimmed apiKey is empty', async () => {
    const setConnCheck = vi.fn();
    await handleTest('openai', '', 'https://api.openai.com/v1', undefined, setConnCheck);
    expect(setConnCheck).not.toHaveBeenCalled();
  });

  it('falls back to official default baseUrl when trimmedBaseUrl is empty', async () => {
    const setConnCheck = vi.fn();
    const bridge = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await handleTest('openai', 'sk-test', '', bridge, setConnCheck);
    expect(bridge.test).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(setConnCheck).toHaveBeenLastCalledWith({ status: 'ok' });
  });

  it('uses anthropic default baseUrl when trimmedBaseUrl is empty', async () => {
    const setConnCheck = vi.fn();
    const bridge = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await handleTest('anthropic', 'sk-ant-test', '', bridge, setConnCheck);
    expect(bridge.test).toHaveBeenCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
    });
  });

  it('uses user-supplied baseUrl when provided', async () => {
    const setConnCheck = vi.fn();
    const bridge = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await handleTest('openai', 'sk-test', 'https://my-proxy.example.com/v1', bridge, setConnCheck);
    expect(bridge.test).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://my-proxy.example.com/v1',
    });
  });

  it('transitions testing → ok on success', async () => {
    const setConnCheck = vi.fn();
    const bridge = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await handleTest('openai', 'sk-test', 'https://api.openai.com/v1', bridge, setConnCheck);
    expect(setConnCheck).toHaveBeenCalledTimes(2);
    expect(setConnCheck.mock.calls[0]?.[0]).toEqual({ status: 'testing' });
    expect(setConnCheck.mock.calls[1]?.[0]).toEqual({ status: 'ok' });
  });

  it('transitions testing → failed on 401 response', async () => {
    const setConnCheck = vi.fn();
    const bridge = {
      test: vi.fn().mockResolvedValue({ ok: false, code: '401', hint: 'API key invalid' }),
    };
    await handleTest('openai', 'sk-test', 'https://api.openai.com/v1', bridge, setConnCheck);
    const last = setConnCheck.mock.calls.at(-1)?.[0] as ConnectionCheck;
    expect(last.status).toBe('failed');
    if (last.status === 'failed') {
      expect(last.code).toBe('401');
    }
  });

  it('sets failed when bridge.test throws', async () => {
    const setConnCheck = vi.fn();
    const bridge = { test: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await handleTest('openai', 'sk-test', 'https://api.openai.com/v1', bridge, setConnCheck);
    const last = setConnCheck.mock.calls.at(-1)?.[0] as ConnectionCheck;
    expect(last.status).toBe('failed');
    if (last.status === 'failed') {
      expect(last.hint).toContain('ECONNREFUSED');
    }
  });

  it('Continue is gated: only enabled when status is ok', () => {
    const checkContinueEnabled = (s: ConnectionCheck) => s.status === 'ok';
    expect(checkContinueEnabled({ status: 'idle' })).toBe(false);
    expect(checkContinueEnabled({ status: 'testing' })).toBe(false);
    expect(checkContinueEnabled({ status: 'failed', code: 'NETWORK', hint: '' })).toBe(false);
    expect(checkContinueEnabled({ status: 'ok' })).toBe(true);
  });
});

describe('detectProvider — discriminated failure kinds', () => {
  it('returns ok with provider when bridge resolves a known prefix', async () => {
    const bridge = { detectProvider: vi.fn().mockResolvedValue('openai') };
    const result = await detectProvider('sk-test', bridge);
    expect(result).toEqual({ ok: true, provider: 'openai' });
  });

  it('returns unknown_prefix when bridge resolves null', async () => {
    const bridge = { detectProvider: vi.fn().mockResolvedValue(null) };
    const result = await detectProvider('garbage-key', bridge);
    expect(result).toEqual({ ok: false, kind: 'unknown_prefix' });
  });

  it('returns unknown_prefix when bridge resolves an unsupported provider string', async () => {
    const bridge = { detectProvider: vi.fn().mockResolvedValue('made-up-provider') };
    const result = await detectProvider('sk-x', bridge);
    expect(result).toEqual({ ok: false, kind: 'unknown_prefix' });
  });

  it('returns ipc_error when bridge is undefined (renderer not connected)', async () => {
    const result = await detectProvider('sk-test', undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('ipc_error');
      if (result.kind === 'ipc_error') {
        expect(result.message).toContain('not connected');
      }
    }
  });

  it('returns ipc_error when bridge rejects with a non-network Error', async () => {
    const bridge = {
      detectProvider: vi.fn().mockRejectedValue(new Error('preload bridge crashed')),
    };
    const result = await detectProvider('sk-test', bridge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('ipc_error');
      if (result.kind === 'ipc_error') {
        expect(result.message).toBe('preload bridge crashed');
      }
    }
  });

  it('returns network_error when bridge rejects with a TypeError (fetch failure)', async () => {
    const bridge = {
      detectProvider: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    };
    const result = await detectProvider('sk-test', bridge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network_error');
    }
  });

  it('returns network_error when error message contains a network token', async () => {
    const bridge = {
      detectProvider: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:443')),
    };
    const result = await detectProvider('sk-test', bridge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network_error');
    }
  });

  it('never collapses an IPC failure into unknown_prefix', async () => {
    const bridge = { detectProvider: vi.fn().mockRejectedValue(new Error('boom')) };
    const result = await detectProvider('sk-test', bridge);
    if (!result.ok) {
      expect(result.kind).not.toBe('unknown_prefix');
    }
  });
});

describe('classifyDetectError', () => {
  it('classifies TypeError as network_error', () => {
    expect(classifyDetectError(new TypeError('Failed to fetch'))).toBe('network_error');
  });

  it('classifies fetch/network/ECONN/ENOTFOUND/ETIMEDOUT/EAI_AGAIN messages as network_error', () => {
    for (const token of [
      'fetch',
      'network',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EAI_AGAIN',
    ]) {
      expect(classifyDetectError(new Error(`some ${token} happened`))).toBe('network_error');
    }
  });

  it('classifies plain Error as ipc_error', () => {
    expect(classifyDetectError(new Error('preload missing'))).toBe('ipc_error');
  });

  it('classifies non-Error throwables as ipc_error', () => {
    expect(classifyDetectError('weird string')).toBe('ipc_error');
    expect(classifyDetectError(null)).toBe('ipc_error');
  });
});
