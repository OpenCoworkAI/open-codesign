import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGenerateBaseUrlFix, useCodesignStore } from './store';

const initialState = useCodesignStore.getState();

function resetStore(): void {
  useCodesignStore.setState({ ...initialState, toasts: [], reportableErrors: [] });
}

function installWindow(updateProvider: unknown): void {
  (globalThis as unknown as { window: { codesign: unknown } }).window = {
    codesign: updateProvider === undefined ? {} : { config: { updateProvider } },
  };
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = undefined;
  vi.restoreAllMocks();
});

describe('applyGenerateBaseUrlFix — silent-fallback regressions for #130', () => {
  it('emits a success toast when IPC updates the provider', async () => {
    const next = { ...(initialState.config ?? { schemaVersion: 3 }) } as unknown;
    const updateProvider = vi.fn().mockResolvedValue(next);
    installWindow(updateProvider);

    const { getState, setState } = useCodesignStore;
    await applyGenerateBaseUrlFix(getState, setState, 'openai-compat', 'https://host/v1');

    expect(updateProvider).toHaveBeenCalledWith({
      id: 'openai-compat',
      baseUrl: 'https://host/v1',
    });
    const toasts = useCodesignStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe('success');
  });

  it('surfaces an error toast when IPC throws — never silent', async () => {
    const updateProvider = vi.fn().mockRejectedValue(new Error('ENOENT config.toml'));
    installWindow(updateProvider);

    const { getState, setState } = useCodesignStore;
    await applyGenerateBaseUrlFix(getState, setState, 'openai-compat', 'https://host/v1');

    const toasts = useCodesignStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe('error');
    expect(toasts[0]?.description).toContain('ENOENT config.toml');
    // Must also be reportable so users can file it.
    expect(useCodesignStore.getState().reportableErrors).toHaveLength(1);
    expect(useCodesignStore.getState().reportableErrors[0]?.code).toBe('GENERATE_FIX_APPLY_FAILED');
  });

  it('surfaces an "unavailable" toast when updateProvider IPC is missing — not silent', async () => {
    installWindow(undefined);

    const { getState, setState } = useCodesignStore;
    await applyGenerateBaseUrlFix(getState, setState, 'openai-compat', 'https://host/v1');

    const toasts = useCodesignStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe('error');
    expect(useCodesignStore.getState().reportableErrors).toHaveLength(1);
    expect(useCodesignStore.getState().reportableErrors[0]?.code).toBe(
      'GENERATE_FIX_APPLY_UNAVAILABLE',
    );
  });
});
