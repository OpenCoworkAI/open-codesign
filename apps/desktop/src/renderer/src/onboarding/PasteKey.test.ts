import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for PasteKey connection guard logic
//
// PasteKey cannot be imported directly because it depends on React and
// Electron-specific globals. Instead we inline the guard logic and test it
// in isolation, mirroring the pattern used in connection-ipc.test.ts.
// ---------------------------------------------------------------------------

type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; code: string; hint: string };

// Mirrors handleConnectionTest from PasteKey.tsx
async function handleConnectionTest(
  provider: string | null,
  trimmed: string,
  trimmedBaseUrl: string,
  connectionBridge: { test: (payload: unknown) => Promise<{ ok: boolean }> } | undefined,
  setConnState: (s: ConnectionState) => void,
): Promise<void> {
  if (!provider || trimmed.length === 0 || trimmedBaseUrl.length === 0) return;
  if (!connectionBridge) {
    setConnState({
      kind: 'error',
      code: 'NETWORK',
      hint: 'Renderer is not connected to the main process.',
    });
    return;
  }
  setConnState({ kind: 'testing' });
  try {
    const result = await connectionBridge.test({
      provider,
      apiKey: trimmed,
      baseUrl: trimmedBaseUrl,
    });
    if (result.ok) {
      setConnState({ kind: 'ok' });
    } else {
      setConnState({ kind: 'error', code: 'NETWORK', hint: 'Connection test failed.' });
    }
  } catch (err) {
    setConnState({
      kind: 'error',
      code: 'NETWORK',
      hint: err instanceof Error ? err.message : 'Connection test failed.',
    });
  }
}

describe('handleConnectionTest — connection bridge guard', () => {
  it('sets NETWORK error when connection bridge is undefined (bridge not yet injected)', async () => {
    const setConnState = vi.fn();
    await handleConnectionTest(
      'openai',
      'sk-test',
      'https://api.openai.com/v1',
      undefined,
      setConnState,
    );
    expect(setConnState).toHaveBeenCalledOnce();
    const firstArg = setConnState.mock.calls[0]?.[0] as ConnectionState | undefined;
    expect(firstArg?.kind).toBe('error');
    if (firstArg?.kind === 'error') {
      expect(firstArg.code).toBe('NETWORK');
      expect(firstArg.hint).toContain('not connected');
    }
  });

  it('does not call setConnState when provider is null', async () => {
    const setConnState = vi.fn();
    await handleConnectionTest(
      null,
      'sk-test',
      'https://api.openai.com/v1',
      undefined,
      setConnState,
    );
    expect(setConnState).not.toHaveBeenCalled();
  });

  it('does not call setConnState when trimmed apiKey is empty', async () => {
    const setConnState = vi.fn();
    await handleConnectionTest('openai', '', 'https://api.openai.com/v1', undefined, setConnState);
    expect(setConnState).not.toHaveBeenCalled();
  });

  it('does not call setConnState when baseUrl is empty', async () => {
    const setConnState = vi.fn();
    await handleConnectionTest('openai', 'sk-test', '', undefined, setConnState);
    expect(setConnState).not.toHaveBeenCalled();
  });

  it('proceeds to testing state when bridge is available', async () => {
    const setConnState = vi.fn();
    const bridge = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await handleConnectionTest(
      'openai',
      'sk-test',
      'https://api.openai.com/v1',
      bridge,
      setConnState,
    );
    expect(setConnState).toHaveBeenCalledTimes(2);
    expect(setConnState.mock.calls[0]?.[0]).toEqual({ kind: 'testing' });
    expect(setConnState.mock.calls[1]?.[0]).toEqual({ kind: 'ok' });
  });

  it('sets NETWORK error when bridge.test throws', async () => {
    const setConnState = vi.fn();
    const bridge = { test: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await handleConnectionTest(
      'openai',
      'sk-test',
      'https://api.openai.com/v1',
      bridge,
      setConnState,
    );
    const lastArg = setConnState.mock.calls.at(-1)?.[0] as ConnectionState | undefined;
    expect(lastArg?.kind).toBe('error');
    if (lastArg?.kind === 'error') {
      expect(lastArg.code).toBe('NETWORK');
      expect(lastArg.hint).toContain('ECONNREFUSED');
    }
  });
});
