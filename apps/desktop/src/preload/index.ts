import type {
  CancelGenerationPayloadV1,
  ChatMessage,
  GeneratePayloadV1,
  LocalInputFile,
  ModelRef,
  OnboardingState,
  SelectedElement,
  SupportedOnboardingProvider,
} from '@open-codesign/shared';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConnectionTestError,
  ConnectionTestResult,
  ModelsListResponse,
} from '../main/connection-ipc';

export type { ConnectionTestError, ConnectionTestResult, ModelsListResponse };

export interface ValidateKeyResult {
  ok: true;
  modelCount: number;
}
export interface ValidateKeyError {
  ok: false;
  code: '401' | '402' | '429' | 'network';
  message: string;
}

export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'zip';
export interface ExportInvokeResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export interface ProviderRow {
  provider: SupportedOnboardingProvider;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  error?: 'decryption_failed' | string;
}

export interface AppPaths {
  config: string;
  configFolder: string;
  logs: string;
  logsFolder: string;
  data: string;
}

export type UpdateChannel = 'stable' | 'beta';

export interface Preferences {
  updateChannel: UpdateChannel;
  generationTimeoutSec: number;
}

const api = {
  detectProvider: (key: string) =>
    ipcRenderer.invoke('codesign:detect-provider', key) as Promise<string | null>,
  generate: (payload: {
    prompt: string;
    history: ChatMessage[];
    model: ModelRef;
    baseUrl?: string;
    referenceUrl?: string;
    attachments: LocalInputFile[];
    generationId: string;
  }) =>
    ipcRenderer.invoke('codesign:v1:generate', {
      schemaVersion: 1,
      ...payload,
    } satisfies GeneratePayloadV1),
  cancelGeneration: (generationId: string) =>
    ipcRenderer.invoke('codesign:v1:cancel-generation', {
      schemaVersion: 1,
      generationId,
    } satisfies CancelGenerationPayloadV1),
  applyComment: (payload: {
    html: string;
    comment: string;
    selection: SelectedElement;
    model?: ModelRef;
    referenceUrl?: string;
    attachments?: LocalInputFile[];
  }) => ipcRenderer.invoke('codesign:apply-comment', payload),
  pickInputFiles: () =>
    ipcRenderer.invoke('codesign:pick-input-files') as Promise<LocalInputFile[]>,
  pickDesignSystemDirectory: () =>
    ipcRenderer.invoke('codesign:pick-design-system-directory') as Promise<OnboardingState>,
  clearDesignSystem: () =>
    ipcRenderer.invoke('codesign:clear-design-system') as Promise<OnboardingState>,
  export: (payload: { format: ExportFormat; htmlContent: string; defaultFilename?: string }) =>
    ipcRenderer.invoke('codesign:export', payload) as Promise<ExportInvokeResponse>,
  locale: {
    getSystem: () => ipcRenderer.invoke('locale:get-system') as Promise<string>,
    getCurrent: () => ipcRenderer.invoke('locale:get-current') as Promise<string>,
    set: (locale: string) => ipcRenderer.invoke('locale:set', locale) as Promise<string>,
  },
  checkForUpdates: () => ipcRenderer.invoke('codesign:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('codesign:download-update'),
  installUpdate: () => ipcRenderer.invoke('codesign:install-update'),
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on('codesign:update-available', listener);
    return () => ipcRenderer.removeListener('codesign:update-available', listener);
  },
  onboarding: {
    getState: () => ipcRenderer.invoke('onboarding:get-state') as Promise<OnboardingState>,
    validateKey: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      baseUrl?: string;
    }) =>
      ipcRenderer.invoke('onboarding:validate-key', input) as Promise<
        ValidateKeyResult | ValidateKeyError
      >,
    saveKey: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      modelPrimary: string;
      modelFast: string;
      baseUrl?: string;
    }) => ipcRenderer.invoke('onboarding:save-key', input) as Promise<OnboardingState>,
    skip: () => ipcRenderer.invoke('onboarding:skip') as Promise<OnboardingState>,
  },
  settings: {
    listProviders: () => ipcRenderer.invoke('settings:v1:list-providers') as Promise<ProviderRow[]>,
    addProvider: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      modelPrimary: string;
      modelFast: string;
      baseUrl?: string;
    }) => ipcRenderer.invoke('settings:v1:add-provider', input) as Promise<ProviderRow[]>,
    deleteProvider: (provider: SupportedOnboardingProvider) =>
      ipcRenderer.invoke('settings:v1:delete-provider', provider) as Promise<ProviderRow[]>,
    setActiveProvider: (input: {
      provider: SupportedOnboardingProvider;
      modelPrimary: string;
      modelFast: string;
    }) => ipcRenderer.invoke('settings:v1:set-active-provider', input) as Promise<OnboardingState>,
    getPaths: () => ipcRenderer.invoke('settings:v1:get-paths') as Promise<AppPaths>,
    openFolder: (path: string) =>
      ipcRenderer.invoke('settings:v1:open-folder', path) as Promise<void>,
    resetOnboarding: () => ipcRenderer.invoke('settings:v1:reset-onboarding') as Promise<void>,
    toggleDevtools: () => ipcRenderer.invoke('settings:v1:toggle-devtools') as Promise<void>,
    validateKey: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      baseUrl?: string;
    }) =>
      ipcRenderer.invoke('onboarding:validate-key', input) as Promise<
        ValidateKeyResult | ValidateKeyError
      >,
  },
  preferences: {
    get: () => ipcRenderer.invoke('preferences:v1:get') as Promise<Preferences>,
    update: (patch: Partial<Preferences>) =>
      ipcRenderer.invoke('preferences:v1:update', patch) as Promise<Preferences>,
  },
  connection: {
    test: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      baseUrl: string;
    }) =>
      ipcRenderer.invoke('connection:v1:test', input) as Promise<
        ConnectionTestResult | ConnectionTestError
      >,
  },
  models: {
    list: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      baseUrl: string;
    }) => ipcRenderer.invoke('models:v1:list', input) as Promise<ModelsListResponse>,
  },
};

contextBridge.exposeInMainWorld('codesign', api);

export type CodesignApi = typeof api;
