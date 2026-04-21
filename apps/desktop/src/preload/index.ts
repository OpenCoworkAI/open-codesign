import type {
  CancelGenerationPayloadV1,
  ChatAppendInput,
  ChatMessage,
  ChatMessageRow,
  CommentCreateInput,
  CommentRow,
  CommentStatus,
  Design,
  DesignSnapshot,
  GeneratePayloadV1,
  LocalInputFile,
  ModelRef,
  OnboardingState,
  ProviderEntry,
  ReasoningLevel,
  SelectedElement,
  SnapshotCreateInput,
  SshAuthMethod,
  SupportedOnboardingProvider,
  WireApi,
} from '@open-codesign/shared';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConnectionTestError,
  ConnectionTestResult,
  ModelsListResponse,
  TestEndpointResponse,
} from '../main/connection-ipc';

export type { ConnectionTestError, ConnectionTestResult, ModelsListResponse, TestEndpointResponse };

export interface ValidateKeyResult {
  ok: true;
  modelCount: number;
}
export interface ValidateKeyError {
  ok: false;
  code: '401' | '402' | '429' | 'network';
  message: string;
}

export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'zip' | 'markdown';
export interface ExportInvokeResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export interface RemoteExportResponse {
  path: string;
  bytes: number;
}

export interface SaveSshProfileInput {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  basePath?: string;
}

export interface ProviderRow {
  provider: string;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  label: string;
  builtin: boolean;
  wire: WireApi;
  defaultModel: string;
  hasKey: boolean;
  reasoningLevel?: ReasoningLevel;
  error?: 'decryption_failed' | string;
}

export interface ExternalConfigsDetection {
  codex?: {
    providers: ProviderEntry[];
    activeProvider: string | null;
    activeModel: string | null;
    warnings: string[];
  };
  claudeCode?: {
    provider: ProviderEntry | null;
    apiKey: string | null;
    activeModel: string | null;
    warnings: string[];
  };
}

export interface AppPaths {
  config: string;
  configFolder: string;
  logs: string;
  logsFolder: string;
  data: string;
}

export type StorageKind = 'config' | 'logs' | 'data';

export type UpdateChannel = 'stable' | 'beta';

export interface GenerateArtifact {
  id: string;
  type: string;
  title: string;
  content: string;
  designParams: unknown[];
  createdAt: string;
}

export interface GenerateResponse {
  message: string;
  artifacts: GenerateArtifact[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Preferences {
  updateChannel: UpdateChannel;
  generationTimeoutSec: number;
}

/**
 * Streaming events emitted by the (future) Agent runtime. Phase 1 emits
 * turn_start / text_delta / turn_end. Phase 2 adds tool_call_*. Kept
 * deliberately loose so Workstream B can evolve the shape without a
 * lockstep change here — useAgentStream in the renderer tolerates unknown
 * event types by ignoring them.
 */
export interface AgentStreamEvent {
  type:
    | 'turn_start'
    | 'text_delta'
    | 'turn_end'
    | 'tool_call_start'
    | 'tool_call_result'
    | 'fs_updated'
    | 'agent_end'
    | 'error';
  designId: string;
  /** Trace ID linking this event to the main-process generation log entry.
   *  Matches the generationId from the codesign:v1:generate payload — always
   *  present because the main process supplies it from baseCtx. */
  generationId: string;
  // turn_start
  turnId?: string;
  // text_delta
  delta?: string;
  // turn_end
  finalText?: string;
  // tool_call_start
  toolName?: string;
  command?: string;
  args?: Record<string, unknown>;
  verbGroup?: string;
  toolCallId?: string;
  // tool_call_result
  result?: unknown;
  durationMs?: number;
  // fs_updated — emitted whenever the agent's text_editor mutates a file in the
  // virtual fs. Renderer uses this to re-render the iframe live during
  // generation so the user can watch the design take shape.
  path?: string;
  content?: string;
  // error
  message?: string;
  code?: string;
}

const api = {
  detectProvider: (key: string) =>
    ipcRenderer.invoke('codesign:detect-provider', key) as Promise<string | null>,
  doneVerify: (artifact: string) =>
    ipcRenderer.invoke('done:verify:v1', { artifact }) as Promise<{
      errors: Array<{ message: string; source?: string; lineno?: number }>;
    }>,
  generate: (payload: {
    prompt: string;
    history: ChatMessage[];
    model: ModelRef;
    baseUrl?: string;
    referenceUrl?: string;
    attachments: LocalInputFile[];
    generationId: string;
    designId?: string;
    previousHtml?: string;
  }) =>
    ipcRenderer.invoke('codesign:v1:generate', {
      schemaVersion: 1,
      ...payload,
    } satisfies GeneratePayloadV1) as Promise<GenerateResponse>,
  cancelGeneration: (generationId: string) =>
    ipcRenderer.invoke('codesign:v1:cancel-generation', {
      schemaVersion: 1,
      generationId,
    } satisfies CancelGenerationPayloadV1),
  generateTitle: (prompt: string) =>
    ipcRenderer.invoke('codesign:v1:generate-title', { prompt }) as Promise<string>,
  applyComment: (payload: {
    html: string;
    comment: string;
    selection: SelectedElement;
    model?: ModelRef;
    referenceUrl?: string;
    attachments?: LocalInputFile[];
  }) => ipcRenderer.invoke('codesign:apply-comment', payload) as Promise<GenerateResponse>,
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
  remote: {
    testProfile: (input: SaveSshProfileInput) =>
      ipcRenderer.invoke('remote:v1:test-profile', input) as Promise<{ ok: true }>,
    testSavedProfile: (id: string) =>
      ipcRenderer.invoke('remote:v1:test-saved-profile', id) as Promise<{ ok: true }>,
    saveProfile: (input: SaveSshProfileInput) =>
      ipcRenderer.invoke('remote:v1:save-profile', input) as Promise<OnboardingState>,
    deleteProfile: (id: string) =>
      ipcRenderer.invoke('remote:v1:delete-profile', id) as Promise<OnboardingState>,
    attachFile: (input: { profileId: string; path: string }) =>
      ipcRenderer.invoke('remote:v1:attach-file', input) as Promise<LocalInputFile>,
    linkDesignSystem: (input: { profileId: string; path: string }) =>
      ipcRenderer.invoke('remote:v1:link-design-system', input) as Promise<OnboardingState>,
    export: (input: {
      format: ExportFormat;
      htmlContent: string;
      profileId: string;
      remotePath: string;
    }) => ipcRenderer.invoke('remote:v1:export', input) as Promise<RemoteExportResponse>,
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
      baseUrl?: string;
    }) => ipcRenderer.invoke('settings:v1:add-provider', input) as Promise<ProviderRow[]>,
    deleteProvider: (provider: string) =>
      ipcRenderer.invoke('settings:v1:delete-provider', provider) as Promise<ProviderRow[]>,
    setActiveProvider: (input: { provider: string; modelPrimary: string }) =>
      ipcRenderer.invoke('settings:v1:set-active-provider', input) as Promise<OnboardingState>,
    getPaths: () => ipcRenderer.invoke('settings:v1:get-paths') as Promise<AppPaths>,
    chooseStorageFolder: (kind: StorageKind) =>
      ipcRenderer.invoke('settings:v1:choose-storage-folder', kind) as Promise<AppPaths>,
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
  config: {
    setProviderAndModels: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      modelPrimary: string;
      baseUrl?: string;
      setAsActive: boolean;
    }) =>
      ipcRenderer.invoke('config:v1:set-provider-and-models', {
        schemaVersion: 1,
        ...input,
      }) as Promise<OnboardingState>,
    addProvider: (input: {
      id: string;
      name: string;
      wire: WireApi;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      httpHeaders?: Record<string, string>;
      queryParams?: Record<string, string>;
      envKey?: string;
      setAsActive: boolean;
    }) => ipcRenderer.invoke('config:v1:add-provider', input) as Promise<OnboardingState>,
    updateProvider: (input: {
      id: string;
      name?: string;
      baseUrl?: string;
      defaultModel?: string;
      wire?: WireApi;
      httpHeaders?: Record<string, string>;
      queryParams?: Record<string, string>;
      /** `null` explicitly clears the override and falls back to the model
       *  default; a level string sets it; omit to leave untouched. */
      reasoningLevel?: ReasoningLevel | null;
    }) => ipcRenderer.invoke('config:v1:update-provider', input) as Promise<OnboardingState>,
    removeProvider: (id: string) =>
      ipcRenderer.invoke('config:v1:remove-provider', id) as Promise<OnboardingState>,
    setActiveProviderAndModel: (input: { provider: string; modelPrimary: string }) =>
      ipcRenderer.invoke(
        'config:v1:set-active-provider-and-model',
        input,
      ) as Promise<OnboardingState>,
    testEndpoint: (input: {
      wire: WireApi;
      baseUrl: string;
      apiKey: string;
      httpHeaders?: Record<string, string>;
    }) => ipcRenderer.invoke('config:v1:test-endpoint', input) as Promise<TestEndpointResponse>,
    listEndpointModels: (input: { wire: WireApi; baseUrl: string; apiKey: string }) =>
      ipcRenderer.invoke('config:v1:list-endpoint-models', input) as Promise<
        { ok: true; models: string[] } | { ok: false; error: string }
      >,
    detectExternalConfigs: () =>
      ipcRenderer.invoke('config:v1:detect-external-configs') as Promise<ExternalConfigsDetection>,
    importCodexConfig: () =>
      ipcRenderer.invoke('config:v1:import-codex-config') as Promise<OnboardingState>,
    importClaudeCodeConfig: () =>
      ipcRenderer.invoke('config:v1:import-claude-code-config') as Promise<OnboardingState>,
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
    testActive: () =>
      ipcRenderer.invoke('connection:v1:test-active') as Promise<
        ConnectionTestResult | ConnectionTestError
      >,
    testProvider: (providerId: string) =>
      ipcRenderer.invoke('connection:v1:test-provider', providerId) as Promise<
        ConnectionTestResult | ConnectionTestError
      >,
  },
  models: {
    list: (input: {
      provider: SupportedOnboardingProvider;
      apiKey: string;
      baseUrl: string;
    }) => ipcRenderer.invoke('models:v1:list', input) as Promise<ModelsListResponse>,
    listForProvider: (providerId: string) =>
      ipcRenderer.invoke('models:v1:list-for-provider', providerId) as Promise<ModelsListResponse>,
  },
  snapshots: {
    listDesigns: () =>
      ipcRenderer.invoke('snapshots:v1:list-designs', { schemaVersion: 1 }) as Promise<Design[]>,
    createDesign: (name: string) =>
      ipcRenderer.invoke('snapshots:v1:create-design', {
        schemaVersion: 1,
        name,
      }) as Promise<Design>,
    getDesign: (id: string) =>
      ipcRenderer.invoke('snapshots:v1:get-design', {
        schemaVersion: 1,
        id,
      }) as Promise<Design | null>,
    renameDesign: (id: string, name: string) =>
      ipcRenderer.invoke('snapshots:v1:rename-design', {
        schemaVersion: 1,
        id,
        name,
      }) as Promise<Design>,
    setThumbnail: (id: string, thumbnailText: string | null) =>
      ipcRenderer.invoke('snapshots:v1:set-thumbnail', {
        schemaVersion: 1,
        id,
        thumbnailText,
      }) as Promise<Design>,
    softDeleteDesign: (id: string) =>
      ipcRenderer.invoke('snapshots:v1:soft-delete-design', {
        schemaVersion: 1,
        id,
      }) as Promise<Design>,
    duplicateDesign: (id: string, name: string) =>
      ipcRenderer.invoke('snapshots:v1:duplicate-design', {
        schemaVersion: 1,
        id,
        name,
      }) as Promise<Design>,
    list: (designId: string) =>
      ipcRenderer.invoke('snapshots:v1:list', { schemaVersion: 1, designId }) as Promise<
        DesignSnapshot[]
      >,
    get: (id: string) =>
      ipcRenderer.invoke('snapshots:v1:get', {
        schemaVersion: 1,
        id,
      }) as Promise<DesignSnapshot | null>,
    create: (input: SnapshotCreateInput) =>
      ipcRenderer.invoke('snapshots:v1:create', {
        schemaVersion: 1,
        ...input,
      }) as Promise<DesignSnapshot>,
    delete: (id: string) =>
      ipcRenderer.invoke('snapshots:v1:delete', { schemaVersion: 1, id }) as Promise<void>,
  },
  chat: {
    list: (designId: string) =>
      ipcRenderer.invoke('chat:v1:list', { schemaVersion: 1, designId }) as Promise<
        ChatMessageRow[]
      >,
    append: (input: ChatAppendInput) =>
      ipcRenderer.invoke('chat:v1:append', {
        schemaVersion: 1,
        ...input,
      }) as Promise<ChatMessageRow>,
    seedFromSnapshots: (designId: string) =>
      ipcRenderer.invoke('chat:v1:seed-from-snapshots', {
        schemaVersion: 1,
        designId,
      }) as Promise<{ inserted: number }>,
    updateToolStatus: (input: {
      designId: string;
      seq: number;
      status: 'done' | 'error';
      errorMessage?: string;
    }) =>
      ipcRenderer.invoke('chat:update-tool-status:v1', {
        schemaVersion: 1,
        ...input,
      }) as Promise<{ ok: true }>,
    onAgentEvent: (cb: (event: AgentStreamEvent) => void) => {
      const listener = (_e: unknown, event: AgentStreamEvent) => cb(event);
      ipcRenderer.on('agent:event:v1', listener);
      return () => ipcRenderer.removeListener('agent:event:v1', listener);
    },
  },
  comments: {
    add: (input: CommentCreateInput) =>
      ipcRenderer.invoke('comments:v1:add', {
        schemaVersion: 1,
        ...input,
      }) as Promise<CommentRow>,
    list: (designId: string, snapshotId?: string) =>
      ipcRenderer.invoke('comments:v1:list', {
        schemaVersion: 1,
        designId,
        ...(snapshotId !== undefined ? { snapshotId } : {}),
      }) as Promise<CommentRow[]>,
    listPendingEdits: (designId: string) =>
      ipcRenderer.invoke('comments:v1:list-pending-edits', {
        schemaVersion: 1,
        designId,
      }) as Promise<CommentRow[]>,
    update: (id: string, patch: { text?: string; status?: CommentStatus }) =>
      ipcRenderer.invoke('comments:v1:update', {
        schemaVersion: 1,
        id,
        ...patch,
      }) as Promise<CommentRow | null>,
    remove: (id: string) =>
      ipcRenderer.invoke('comments:v1:remove', {
        schemaVersion: 1,
        id,
      }) as Promise<{ removed: boolean }>,
    markApplied: (ids: string[], snapshotId: string) =>
      ipcRenderer.invoke('comments:v1:mark-applied', {
        schemaVersion: 1,
        ids,
        snapshotId,
      }) as Promise<CommentRow[]>,
  },
  diagnostics: {
    log: (entry: {
      schemaVersion: 1;
      level: 'info' | 'warn' | 'error';
      scope: string;
      message: string;
      data?: Record<string, unknown>;
      stack?: string;
    }) => ipcRenderer.invoke('diagnostics:v1:log', entry) as Promise<void>,
    openLogFolder: () => ipcRenderer.invoke('diagnostics:v1:openLogFolder') as Promise<void>,
    exportDiagnostics: () =>
      ipcRenderer.invoke('diagnostics:v1:exportDiagnostics') as Promise<string>,
    showItemInFolder: (path: string) =>
      ipcRenderer.invoke('diagnostics:v1:showItemInFolder', path) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('codesign', api);

export type CodesignApi = typeof api;
