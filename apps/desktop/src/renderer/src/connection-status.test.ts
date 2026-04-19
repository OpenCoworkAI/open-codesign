import { initI18n } from '@open-codesign/i18n';
import type { OnboardingState } from '@open-codesign/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const READY_CONFIG: OnboardingState = {
  hasKey: true,
  provider: 'anthropic',
  modelPrimary: 'claude-sonnet-4-6',
  baseUrl: null,
  designSystem: null,
};

const initialState = useCodesignStore.getState();

function resetStore(config: OnboardingState | null = READY_CONFIG) {
  useCodesignStore.setState({
    ...initialState,
    messages: [],
    previewHtml: null,
    isGenerating: false,
    activeGenerationId: null,
    errorMessage: null,
    lastError: null,
    config,
    configLoaded: true,
    toastMessage: null,
    iframeErrors: [],
    toasts: [],
    connectionStatus: { state: 'untested', lastTestedAt: null, lastError: null },
  });
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  resetStore();
  vi.unstubAllGlobals();
});

describe('connectionStatus store', () => {
  it('setConnectionStatus updates the connectionStatus slice', () => {
    useCodesignStore.getState().setConnectionStatus({
      state: 'connected',
      lastTestedAt: 12345,
      lastError: null,
    });
    expect(useCodesignStore.getState().connectionStatus).toEqual({
      state: 'connected',
      lastTestedAt: 12345,
      lastError: null,
    });
  });

  it('testConnection sets state=no_provider when config is null', async () => {
    resetStore(null);
    vi.stubGlobal('window', {});
    await useCodesignStore.getState().testConnection();
    expect(useCodesignStore.getState().connectionStatus.state).toBe('no_provider');
  });

  it('testConnection sets state=no_provider when window.codesign is missing', async () => {
    vi.stubGlobal('window', {});
    await useCodesignStore.getState().testConnection();
    expect(useCodesignStore.getState().connectionStatus.state).toBe('no_provider');
  });

  it('testConnection sets state=connected on ok result', async () => {
    vi.stubGlobal('window', {
      codesign: {
        connection: {
          testActive: vi.fn(() => Promise.resolve({ ok: true })),
        },
      },
    });
    await useCodesignStore.getState().testConnection();
    const { state, lastTestedAt, lastError } = useCodesignStore.getState().connectionStatus;
    expect(state).toBe('connected');
    expect(lastTestedAt).not.toBeNull();
    expect(lastError).toBeNull();
  });

  it('testConnection sets state=error on failure result', async () => {
    vi.stubGlobal('window', {
      codesign: {
        connection: {
          testActive: vi.fn(() =>
            Promise.resolve({ ok: false, code: '401', message: 'Unauthorized', hint: '' }),
          ),
        },
      },
    });
    await useCodesignStore.getState().testConnection();
    const { state, lastError } = useCodesignStore.getState().connectionStatus;
    expect(state).toBe('error');
    expect(lastError).toBe('Unauthorized');
  });

  it('testConnection sets state=error when testActive throws', async () => {
    vi.stubGlobal('window', {
      codesign: {
        connection: {
          testActive: vi.fn(() => Promise.reject(new Error('Network failure'))),
        },
      },
    });
    await useCodesignStore.getState().testConnection();
    const { state, lastError } = useCodesignStore.getState().connectionStatus;
    expect(state).toBe('error');
    expect(lastError).toBe('Network failure');
  });
});
