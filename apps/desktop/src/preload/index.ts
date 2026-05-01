import type {
  CancelGenerationPayloadV1,
  ChatAppendInput,
  ChatMessage,
  ChatMessageRow,
  ClaudeCodeUserType,
  CommentCreateInput,
  CommentRow,
  CommentStatus,
  Design,
  DesignSnapshot,
  ExternalConfigsDetection,
  GeneratePayloadV1,
  ListEventsInput,
  ListEventsResult,
  LocalInputFile,
  ModelRef,
  OnboardingState,
  ReasoningLevel,
  ReportEventInput,
  ReportEventResult,
  SelectedElement,
  SnapshotCreateInput,
  SupportedOnboardingProvider,
  WireApi,
} from '@open-codesign/shared';
import { contextBridge, ipcRenderer } from 'electron';
import type { CodexOAuthStatus } from '../main/codex-oauth-ipc';
import type {
  ConnectionTestError,
  ConnectionTestResult,
  ModelsListResponse,
  TestEndpointResponse,
} from '../main/connection-ipc';
import type { ImageGenerationSettingsView } from '../main/image-generation-settings';

export type {
  ClaudeCodeUserType,
  CodexOAuthStatus,
  ConnectionTestError,
  ConnectionTestResult,
  ExternalConfigsDetection,
  ImageGenerationSettingsView,
  ModelsListResponse,
  TestEndpointResponse,
};

export interface ValidateKeyResult {
  ok: true;
  modelCount: number;
}
export interface ValidateKeyError {
  ok: false;
  code: '401' | '402' | '429' | 'network' | 'parse';
  message: string;
}

export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'zip' | 'markdown';
export type WorkspaceFileKind = 'html' | 'jsx' | 'tsx' | 'css' | 'js' | 'asset';
export interface WorkspaceFileEntry {
  path: string;
  kind: WorkspaceFileKind;
  size: number;
  updatedAt: string;
}
export interface WorkspaceFileReadResult extends WorkspaceFileEntry {
  content: string;
}

export interface ExportInvokeResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export interface ProviderRow {
  provider: string;
  maskedKey: string;
  baseUrl: string | null;
  isActive: boolean;
  label: string;
  /** Stored entry name — differs from `label` for codex-imported rows
   *  where `label` is the localized alias "Codex (imported)". */
  name: string;
  builtin: boolean;
  wire: WireApi;
  defaultModel: string;
  hasKey: boolean;
  reasoningLevel?: ReasoningLevel;
  error?: 'decryption_failed' | string;
}

// `ClaudeCodeUserType` and `ExternalConfigsDetection` now live in
// `packages/shared/src/detection.ts` so main and preload stay in lockstep —
// see that file for the drift-risk background. The inline definitions that
// used to live here are gone; re-exports above keep downstream imports
// from breaking.

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
  checkForUpdatesOnStartup: boolean;
  dismissedUpdateVersion: string;
  diagnosticsLastReadTs: number;
}

/**
 * Streaming events emitted by the live agent runtime. Kept deliberately loose
 * so the core event shape can evolve without a lockstep preload change —
 * useAgentStream in the renderer tolerates unknown event types by ignoring
 * them.
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
  // fs_updated — emitted whenever the agent edit tool mutates a file in the
  // virtual fs. Renderer uses this to re-render the iframe live during
  // generation so the user can watch the design take shape.
  path?: string;
  content?: string;
  // error
  message?: string;
  code?: string;
}

/**
 * Ask-tool wire shape. Mirrors packages/core/src/tools/ask.ts — duplicated
 * here so the preload does not take a hard dep on `@open-codesign/core`.
 * Keep in lockstep with the TypeBox schema in that file.
 */
export type AskQuestionType = 'text-options' | 'svg-options' | 'slider' | 'file' | 'freeform';
export interface AskTextOptionsQuestion {
  id: string;
  type: 'text-options';
  prompt: string;
  options: string[];
  multi?: boolean;
}
export interface AskSvgOptionsQuestion {
  id: string;
  type: 'svg-options';
  prompt: string;
  options: Array<{ id: string; label: string; svg: string }>;
}
export interface AskSliderQuestion {
  id: string;
  type: 'slider';
  prompt: string;
  min: number;
  max: number;
  step: number;
  default?: number;
  unit?: string;
}
export interface AskFileQuestion {
  id: string;
  type: 'file';
  prompt: string;
  accept?: string[];
  multiple?: boolean;
}
export interface AskFreeformQuestion {
  id: string;
  type: 'freeform';
  prompt: string;
  placeholder?: string;
  multiline?: boolean;
}
export type AskQuestion =
  | AskTextOptionsQuestion
  | AskSvgOptionsQuestion
  | AskSliderQuestion
  | AskFileQuestion
  | AskFreeformQuestion;
export interface AskInput {
  questions: AskQuestion[];
  rationale?: string;
}
export interface AskAnswer {
  questionId: string;
  value: string | number | string[] | null;
}
export interface AskResult {
  status: 'answered' | 'cancelled';
  answers: AskAnswer[];
}
export interface AskRequest {
  requestId: string;
  sessionId: string;
  input: AskInput;
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
    designId: string;
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
    designId: string;
    generationId: string;
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
    openTemplatesFolder: () =>
      ipcRenderer.invoke('codesign:v1:open-templates-folder') as Promise<void>,
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
      /** Non-empty string rotates the stored secret; empty string clears it
       *  (keyless providers); omit to leave the existing secret untouched. */
      apiKey?: string;
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
    importGeminiConfig: () =>
      ipcRenderer.invoke('config:v1:import-gemini-config') as Promise<OnboardingState>,
    importOpencodeConfig: () =>
      ipcRenderer.invoke('config:v1:import-opencode-config') as Promise<OnboardingState>,
  },
  preferences: {
    get: () => ipcRenderer.invoke('preferences:v1:get') as Promise<Preferences>,
    update: (patch: Partial<Preferences>) =>
      ipcRenderer.invoke('preferences:v1:update', patch) as Promise<Preferences>,
  },
  imageGeneration: {
    get: () =>
      ipcRenderer.invoke('image-generation:v1:get') as Promise<ImageGenerationSettingsView>,
    update: (patch: Partial<ImageGenerationSettingsView> & { apiKey?: string }) =>
      ipcRenderer.invoke(
        'image-generation:v1:update',
        patch,
      ) as Promise<ImageGenerationSettingsView>,
  },
  codexOAuth: {
    status: () => ipcRenderer.invoke('codex-oauth:v1:status') as Promise<CodexOAuthStatus>,
    login: () => ipcRenderer.invoke('codex-oauth:v1:login') as Promise<CodexOAuthStatus>,
    cancelLogin: () => ipcRenderer.invoke('codex-oauth:v1:cancel-login') as Promise<boolean>,
    logout: () => ipcRenderer.invoke('codex-oauth:v1:logout') as Promise<CodexOAuthStatus>,
  },
  connection: {
    test: (input: { provider: SupportedOnboardingProvider; apiKey: string; baseUrl: string }) =>
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
    list: (input: { provider: SupportedOnboardingProvider; apiKey: string; baseUrl: string }) =>
      ipcRenderer.invoke('models:v1:list', input) as Promise<ModelsListResponse>,
    listForProvider: (providerId: string) =>
      ipcRenderer.invoke('models:v1:list-for-provider', providerId) as Promise<ModelsListResponse>,
  },
  ollama: {
    probe: (baseUrl?: string) =>
      ipcRenderer.invoke('ollama:v1:probe', baseUrl) as Promise<
        { ok: true; models: string[] } | { ok: false; code: string; message: string }
      >,
  },
  files: {
    list: (designId: string) =>
      ipcRenderer.invoke('codesign:files:v1:list', {
        schemaVersion: 1,
        designId,
      }) as Promise<WorkspaceFileEntry[]>,
    read: (designId: string, path: string) =>
      ipcRenderer.invoke('codesign:files:v1:read', {
        schemaVersion: 1,
        designId,
        path,
      }) as Promise<WorkspaceFileReadResult>,
    write: (designId: string, path: string, content: string) =>
      ipcRenderer.invoke('codesign:files:v1:write', {
        schemaVersion: 1,
        designId,
        path,
        content,
      }) as Promise<WorkspaceFileReadResult>,
    subscribe: (designId: string) =>
      ipcRenderer.invoke('codesign:files:v1:subscribe', {
        schemaVersion: 1,
        designId,
      }) as Promise<{ ok: true }>,
    unsubscribe: (designId: string) =>
      ipcRenderer.invoke('codesign:files:v1:unsubscribe', {
        schemaVersion: 1,
        designId,
      }) as Promise<{ ok: true }>,
    onChanged: (cb: (event: { schemaVersion: 1; designId: string }) => void) => {
      const listener = (_e: unknown, event: { schemaVersion: 1; designId: string }) => cb(event);
      ipcRenderer.on('codesign:files:v1:changed', listener);
      return () => ipcRenderer.removeListener('codesign:files:v1:changed', listener);
    },
  },
  snapshots: {
    listDesigns: () =>
      ipcRenderer.invoke('snapshots:v1:list-designs', { schemaVersion: 1 }) as Promise<Design[]>,
    createDesign: (name: string, workspacePath?: string | null) =>
      ipcRenderer.invoke('snapshots:v1:create-design', {
        schemaVersion: 1,
        name,
        ...(workspacePath !== undefined ? { workspacePath } : {}),
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
    pickWorkspaceFolder: () =>
      ipcRenderer.invoke('snapshots:v1:workspace:pick', {
        schemaVersion: 1,
      }) as Promise<string | null>,
    updateWorkspace: (designId: string, workspacePath: string, migrateFiles: boolean) =>
      ipcRenderer.invoke('snapshots:v1:workspace:update', {
        schemaVersion: 1,
        designId,
        workspacePath,
        migrateFiles,
      }) as Promise<Design>,
    openWorkspaceFolder: (designId: string) =>
      ipcRenderer.invoke('snapshots:v1:workspace:open', {
        schemaVersion: 1,
        designId,
      }) as Promise<void>,
    checkWorkspaceFolder: (designId: string) =>
      ipcRenderer.invoke('snapshots:v1:workspace:check', {
        schemaVersion: 1,
        designId,
      }) as Promise<{ exists: boolean }>,
  },
  chat: {
    list: (designId: string) =>
      ipcRenderer.invoke('chat:v1:list', {
        schemaVersion: 1,
        designId,
      }) as Promise<ChatMessageRow[]>,
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
    updateToolStatus: (_input: {
      designId: string;
      seq: number;
      status: 'done' | 'error';
      result?: unknown;
      durationMs?: number;
      errorMessage?: string;
    }) =>
      ipcRenderer.invoke('chat:v1:update-tool-status', {
        schemaVersion: 1,
        ..._input,
      }) as Promise<{ ok: true }>,
    onAgentEvent: (cb: (event: AgentStreamEvent) => void) => {
      const listener = (_e: unknown, event: AgentStreamEvent) => cb(event);
      ipcRenderer.on('agent:event:v1', listener);
      return () => ipcRenderer.removeListener('agent:event:v1', listener);
    },
  },
  comments: {
    // TODO(v0.2): re-route through session JSONL — see T2.6.
    // Stubs reject so renderer surfaces a toast instead of pushing
    // `null` rows into the store (which used to crash CommentChipBar).
    add: (_input: CommentCreateInput) =>
      Promise.reject(
        new Error('Comments are being migrated to session JSONL in v0.2 — not yet wired.'),
      ) as Promise<CommentRow>,
    list: (_designId: string, _snapshotId?: string) => Promise.resolve([] as CommentRow[]),
    listPendingEdits: (_designId: string) => Promise.resolve([] as CommentRow[]),
    update: (_id: string, _patch: { text?: string; status?: CommentStatus }) =>
      Promise.resolve(null as CommentRow | null),
    remove: (_id: string) => Promise.resolve({ removed: false }),
    markApplied: (_ids: string[], _snapshotId: string) => Promise.resolve([] as CommentRow[]),
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
    recordRendererError: (input: {
      schemaVersion: 1;
      code: string;
      scope: string;
      message: string;
      stack?: string;
      runId?: string;
      context?: Record<string, unknown>;
    }) =>
      ipcRenderer.invoke('diagnostics:v1:recordRendererError', input) as Promise<{
        schemaVersion: 1;
        eventId: number | null;
      }>,
    openLogFolder: () => ipcRenderer.invoke('diagnostics:v1:openLogFolder') as Promise<void>,
    exportDiagnostics: () =>
      ipcRenderer.invoke('diagnostics:v1:exportDiagnostics') as Promise<string>,
    showItemInFolder: (path: string) =>
      ipcRenderer.invoke('diagnostics:v1:showItemInFolder', path) as Promise<void>,
    listEvents: (input: ListEventsInput) =>
      ipcRenderer.invoke('diagnostics:v1:listEvents', input) as Promise<ListEventsResult>,
    reportEvent: (input: ReportEventInput) =>
      ipcRenderer.invoke('diagnostics:v1:reportEvent', input) as Promise<ReportEventResult>,
    isFingerprintRecentlyReported: (fingerprint: string) =>
      ipcRenderer.invoke('diagnostics:v1:isFingerprintRecentlyReported', {
        schemaVersion: 1,
        fingerprint,
      }) as Promise<{
        schemaVersion: 1;
        reported: boolean;
        ts?: number;
        issueUrl?: string;
      }>,
  },
  openExternal: (url: string) =>
    ipcRenderer.invoke('codesign:v1:open-external', url) as Promise<void>,
  ask: {
    onRequest: (cb: (req: AskRequest) => void) => {
      const listener = (_e: unknown, req: AskRequest) => cb(req);
      ipcRenderer.on('ask:request', listener);
      return () => ipcRenderer.removeListener('ask:request', listener);
    },
    resolve: (requestId: string, result: AskResult) =>
      ipcRenderer.invoke('ask:resolve', { requestId, ...result }) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('codesign', api);

export type CodesignApi = typeof api;
