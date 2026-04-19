import { i18n } from '@open-codesign/i18n';
import {
  type ChatMessage,
  type Design,
  type LocalInputFile,
  type ModelRef,
  type OnboardingState,
  PROJECT_SCHEMA_VERSION,
  Project,
  type ProjectDraft,
  type SelectedElement,
  type SupportedOnboardingProvider,
} from '@open-codesign/shared';
import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import type { CodesignApi, ExportFormat } from '../../preload/index';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

export type GenerationStage =
  | 'idle'
  | 'sending'
  | 'thinking'
  | 'streaming'
  | 'parsing'
  | 'rendering'
  | 'done'
  | 'error';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

export type ConnectionState = 'connected' | 'untested' | 'error' | 'no_provider';

export interface ConnectionStatus {
  state: ConnectionState;
  lastTestedAt: number | null;
  lastError: string | null;
}

export type Theme = 'light' | 'dark';
export type AppView = 'hub' | 'workspace' | 'settings';
export type HubTab = 'recent' | 'your' | 'examples' | 'designSystems';

export type PreviewViewport = 'desktop' | 'tablet' | 'mobile';

interface PromptRequest {
  prompt: string;
  attachments: LocalInputFile[];
  referenceUrl?: string | undefined;
}

interface CodesignState {
  messages: ChatMessage[];
  previewHtml: string | null;
  isGenerating: boolean;
  activeGenerationId: string | null;
  generationStage: GenerationStage;
  streamingTokenCount: number;
  errorMessage: string | null;
  lastError: string | null;
  config: OnboardingState | null;
  configLoaded: boolean;
  toastMessage: string | null;
  connectionStatus: ConnectionStatus;

  designs: Design[];
  currentDesignId: string | null;
  designsLoaded: boolean;
  designsViewOpen: boolean;
  designToDelete: Design | null;
  designToRename: Design | null;

  theme: Theme;
  view: AppView;
  hubTab: HubTab;
  projects: Project[];
  currentProjectId: string | null;
  createProjectModalOpen: boolean;
  previewViewport: PreviewViewport;
  commandPaletteOpen: boolean;
  toasts: Toast[];
  iframeErrors: string[];

  inputFiles: LocalInputFile[];
  referenceUrl: string;
  lastPromptInput: PromptRequest | null;
  selectedElement: SelectedElement | null;
  previewZoom: number;

  loadConfig: () => Promise<void>;
  completeOnboarding: (next: OnboardingState) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  testConnection: () => Promise<void>;
  sendPrompt: (input: {
    prompt: string;
    attachments?: LocalInputFile[] | undefined;
    referenceUrl?: string | undefined;
  }) => Promise<void>;
  cancelGeneration: () => void;
  retryLastPrompt: () => Promise<void>;
  applyInlineComment: (comment: string) => Promise<void>;
  clearError: () => void;
  clearIframeErrors: () => void;
  pushIframeError: (message: string) => void;
  exportActive: (format: ExportFormat) => Promise<void>;

  pickInputFiles: () => Promise<void>;
  removeInputFile: (path: string) => void;
  clearInputFiles: () => void;
  setReferenceUrl: (value: string) => void;
  pickDesignSystemDirectory: () => Promise<void>;
  clearDesignSystem: () => Promise<void>;

  selectCanvasElement: (selection: SelectedElement) => void;
  clearCanvasElement: () => void;
  setPreviewZoom: (zoom: number) => void;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (view: AppView) => void;
  setHubTab: (tab: HubTab) => void;
  openCreateProjectModal: () => void;
  closeCreateProjectModal: () => void;
  createProject: (draft: ProjectDraft) => Project;
  openProject: (id: string) => void;
  setPreviewViewport: (viewport: PreviewViewport) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  loadDesigns: () => Promise<void>;
  ensureCurrentDesign: () => Promise<void>;
  createNewDesign: () => Promise<Design | null>;
  switchDesign: (id: string) => Promise<void>;
  renameCurrentDesign: (name: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  duplicateDesign: (id: string) => Promise<Design | null>;
  softDeleteDesign: (id: string) => Promise<void>;
  openDesignsView: () => void;
  closeDesignsView: () => void;
  requestDeleteDesign: (design: Design | null) => void;
  requestRenameDesign: (design: Design | null) => void;

  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id?: string) => void;
}

const THEME_STORAGE_KEY = 'open-codesign:theme';
const PROJECTS_STORAGE_KEY = 'open-codesign:projects:v1';

type ProjectsReadResult = { projects: Project[]; error: string | null };

function readStoredProjects(): ProjectsReadResult {
  if (typeof window === 'undefined') return { projects: [], error: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[open-codesign] Failed to read projects from storage:', err);
    return { projects: [], error: msg };
  }
  if (!raw) return { projects: [], error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[open-codesign] Failed to parse stored projects:', err);
    return { projects: [], error: msg };
  }
  if (!Array.isArray(parsed)) {
    const msg = 'Invalid projects storage payload: expected array';
    console.warn(`[open-codesign] ${msg}`);
    return { projects: [], error: msg };
  }
  const projects: Project[] = [];
  let invalidCount = 0;
  for (const item of parsed) {
    const result = Project.safeParse(item);
    if (result.success && result.data.schemaVersion === PROJECT_SCHEMA_VERSION) {
      projects.push(result.data);
    } else {
      invalidCount += 1;
    }
  }
  if (invalidCount > 0) {
    const msg = `Skipped ${invalidCount} invalid project record(s) in storage`;
    console.warn(`[open-codesign] ${msg}`);
    return { projects, error: msg };
  }
  return { projects, error: null };
}

function persistProjects(projects: Project[]): { error: string | null } {
  if (typeof window === 'undefined') return { error: null };
  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[open-codesign] Failed to persist projects to storage:', err);
    return { error: msg };
  }
}

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'light';
}

function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function modelRef(provider: SupportedOnboardingProvider, modelId: string): ModelRef {
  return { provider, modelId };
}

function normalizeReferenceUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function uniqueFiles(files: LocalInputFile[]): LocalInputFile[] {
  const seen = new Set<string>();
  const result: LocalInputFile[] = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    result.push(file);
  }
  return result;
}

function tr(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options ?? {}) as string;
}

type SetState = StoreApi<CodesignState>['setState'];
type GetState = StoreApi<CodesignState>['getState'];

function autoNameFromPrompt(prompt: string): string {
  const condensed = prompt.replace(/\s+/g, ' ').trim();
  if (condensed.length === 0) return 'Untitled design';
  return condensed.length > 40 ? `${condensed.slice(0, 40).trimEnd()}…` : condensed;
}

function isDefaultDesignName(name: string): boolean {
  return name === 'Untitled design' || /^Untitled design \d+$/.test(name);
}

async function persistDesignState(
  get: GetState,
  designId: string,
  messages: ChatMessage[],
  previewHtml: string | null,
): Promise<void> {
  if (!window.codesign) return;
  try {
    await window.codesign.snapshots.replaceMessages(
      designId,
      messages.map((m) => ({ role: m.role, content: m.content })),
    );
    if (previewHtml !== null) {
      const firstUser = messages.find((m) => m.role === 'user');
      const thumbText = firstUser ? firstUser.content.slice(0, 200) : null;
      await window.codesign.snapshots.setThumbnail(designId, thumbText);
    }
    await get().loadDesigns();
  } catch (err) {
    const msg = err instanceof Error ? err.message : tr('errors.unknown');
    get().pushToast({
      variant: 'error',
      title: tr('projects.notifications.saveFailed'),
      description: msg,
    });
    throw err instanceof Error ? err : new Error(msg);
  }
}

async function maybeAutoRename(
  get: GetState,
  designId: string,
  firstPrompt: string,
): Promise<void> {
  if (!window.codesign) return;
  const design = get().designs.find((d) => d.id === designId);
  if (!design || !isDefaultDesignName(design.name)) return;
  const newName = autoNameFromPrompt(firstPrompt);
  try {
    await window.codesign.snapshots.renameDesign(designId, newName);
    await get().loadDesigns();
  } catch (err) {
    const msg = err instanceof Error ? err.message : tr('errors.unknown');
    get().pushToast({
      variant: 'error',
      title: tr('projects.notifications.renameFailed'),
      description: msg,
    });
    throw err instanceof Error ? err : new Error(msg);
  }
}

function triggerAutoRenameIfFirst(get: GetState, isFirstPrompt: boolean, prompt: string): void {
  if (!isFirstPrompt) return;
  const designId = get().currentDesignId;
  if (designId) void maybeAutoRename(get, designId, prompt);
}

interface ReadyConfig extends OnboardingState {
  hasKey: true;
  provider: SupportedOnboardingProvider;
  modelPrimary: string;
}

function isReadyConfig(cfg: OnboardingState | null): cfg is ReadyConfig {
  if (cfg === null) return false;
  return cfg.hasKey && cfg.provider !== null && cfg.modelPrimary !== null;
}

function finishIfCurrent(
  set: SetState,
  generationId: string,
  update: (state: CodesignState) => Partial<CodesignState>,
): void {
  set((state) => (state.activeGenerationId === generationId ? update(state) : {}));
}

function applyGenerateSuccess(
  set: SetState,
  get: GetState,
  generationId: string,
  result: { artifacts: Array<{ content: string }>; message: string },
): void {
  const firstArtifact = result.artifacts[0];
  finishIfCurrent(set, generationId, (state) => ({
    messages: [
      ...state.messages,
      { role: 'assistant', content: result.message || tr('common.done') },
    ],
    previewHtml: firstArtifact?.content ?? state.previewHtml,
    isGenerating: false,
    activeGenerationId: null,
    generationStage: 'done' as GenerationStage,
  }));
  const designId = get().currentDesignId;
  if (designId) {
    void persistDesignState(get, designId, get().messages, get().previewHtml);
  }
}

function applyGenerateError(
  get: GetState,
  set: SetState,
  generationId: string,
  err: unknown,
): void {
  const msg = err instanceof Error ? err.message : tr('errors.unknown');
  if (get().activeGenerationId !== generationId) return;

  finishIfCurrent(set, generationId, (state) => ({
    messages: [...state.messages, { role: 'assistant', content: `Error: ${msg}` }],
    isGenerating: false,
    activeGenerationId: null,
    errorMessage: msg,
    lastError: msg,
    generationStage: 'error' as GenerationStage,
  }));
  get().pushToast({
    variant: 'error',
    title: tr('notifications.generationFailed'),
    description: msg,
  });
}

function advanceStageIfCurrent(
  get: GetState,
  set: SetState,
  generationId: string,
  stage: GenerationStage,
): void {
  if (get().activeGenerationId === generationId) set({ generationStage: stage });
}

async function runGenerate(
  get: GetState,
  set: SetState,
  generationId: string,
  payload: Parameters<CodesignApi['generate']>[0],
): Promise<void> {
  advanceStageIfCurrent(get, set, generationId, 'thinking');
  // Enter streaming stage before the IPC call so the UI shows "receiving response"
  // while the main process communicates with the model provider.
  advanceStageIfCurrent(get, set, generationId, 'streaming');
  const api = window.codesign;
  if (!api) throw new Error(tr('errors.rendererDisconnected'));
  const result = await api.generate(payload);
  // Response fully received — move through parsing → rendering before finalising.
  advanceStageIfCurrent(get, set, generationId, 'parsing');
  advanceStageIfCurrent(get, set, generationId, 'rendering');
  applyGenerateSuccess(
    set,
    get,
    generationId,
    result as { artifacts: Array<{ content: string }>; message: string },
  );
}

function buildPromptRequest(
  input: {
    prompt: string;
    attachments?: LocalInputFile[] | undefined;
    referenceUrl?: string | undefined;
  },
  storeInputFiles: LocalInputFile[],
  storeReferenceUrl: string,
): PromptRequest | null {
  const prompt = input.prompt.trim();
  if (!prompt) return null;
  const refUrl = normalizeReferenceUrl(input.referenceUrl ?? storeReferenceUrl);
  return {
    prompt,
    attachments: uniqueFiles(input.attachments ?? storeInputFiles),
    ...(refUrl ? { referenceUrl: refUrl } : {}),
  };
}

const initialProjectsRead = readStoredProjects();

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  activeGenerationId: null,
  generationStage: 'idle' as GenerationStage,
  streamingTokenCount: 0,
  errorMessage: null,
  lastError: null,
  config: null,
  configLoaded: false,
  toastMessage: null,
  connectionStatus: { state: 'no_provider', lastTestedAt: null, lastError: null },

  theme: readInitialTheme(),
  view: 'hub' as AppView,
  hubTab: 'recent' as HubTab,
  projects: initialProjectsRead.projects,
  currentProjectId: null,
  createProjectModalOpen: false,
  previewViewport: 'desktop' as PreviewViewport,
  commandPaletteOpen: false,
  toasts: [],
  iframeErrors: [],

  designs: [],
  currentDesignId: null,
  designsLoaded: false,
  designsViewOpen: false,
  designToDelete: null,
  designToRename: null,

  inputFiles: [],
  referenceUrl: '',
  lastPromptInput: null,
  selectedElement: null,
  previewZoom: 100,

  clearIframeErrors() {
    set({ iframeErrors: [] });
  },

  pushIframeError(message) {
    set((s) => {
      const last = s.iframeErrors[s.iframeErrors.length - 1];
      if (last === message) return {};
      const next = [...s.iframeErrors, message];
      return { iframeErrors: next.length > 50 ? next.slice(1) : next };
    });
  },

  async loadConfig() {
    if (!window.codesign) {
      set({
        configLoaded: true,
        errorMessage: tr('errors.rendererDisconnected'),
      });
      return;
    }
    const state = await window.codesign.onboarding.getState();
    set({ config: state, configLoaded: true });
    if (state.hasKey) {
      await get().ensureCurrentDesign();
    }
  },

  completeOnboarding(next: OnboardingState) {
    set({ config: next });
  },

  setConnectionStatus(status: ConnectionStatus) {
    set({ connectionStatus: status });
  },

  async testConnection() {
    const cfg = get().config;
    if (!window.codesign || cfg === null || !cfg.hasKey || cfg.provider === null) {
      set({ connectionStatus: { state: 'no_provider', lastTestedAt: null, lastError: null } });
      return;
    }
    const result = await window.codesign.connection.testActive().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      return { ok: false as const, code: 'NETWORK' as const, message: msg, hint: msg };
    });
    if (result.ok) {
      set({ connectionStatus: { state: 'connected', lastTestedAt: Date.now(), lastError: null } });
    } else {
      set({
        connectionStatus: { state: 'error', lastTestedAt: Date.now(), lastError: result.message },
      });
    }
  },

  async pickInputFiles() {
    if (!window.codesign) return;
    const files = await window.codesign.pickInputFiles();
    if (files.length === 0) return;
    set((s) => ({ inputFiles: uniqueFiles([...s.inputFiles, ...files]) }));
  },

  removeInputFile(path) {
    set((s) => ({ inputFiles: s.inputFiles.filter((file) => file.path !== path) }));
  },

  clearInputFiles() {
    set({ inputFiles: [] });
  },

  setReferenceUrl(value) {
    set({ referenceUrl: value });
  },

  async pickDesignSystemDirectory() {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.pickDesignSystemDirectory();
      set({ config: next });
      if (next.designSystem) {
        get().pushToast({
          variant: 'success',
          title: tr('notifications.designSystemLinked'),
          description: next.designSystem.summary,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : tr('errors.generic');
      get().pushToast({
        variant: 'error',
        title: tr('notifications.designSystemScanFailed'),
        description: message,
      });
    }
  },

  async clearDesignSystem() {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.clearDesignSystem();
      set({ config: next });
      get().pushToast({ variant: 'info', title: tr('notifications.designSystemCleared') });
    } catch (err) {
      const message = err instanceof Error ? err.message : tr('errors.generic');
      get().pushToast({
        variant: 'error',
        title: tr('notifications.clearDesignSystemFailed'),
        description: message,
      });
    }
  },

  async sendPrompt(input) {
    if (get().isGenerating) return;
    if (!window.codesign) {
      const msg = tr('errors.rendererDisconnected');
      set({ errorMessage: msg, lastError: msg });
      return;
    }
    const cfg = get().config;
    if (!isReadyConfig(cfg)) {
      const msg = tr('errors.onboardingIncomplete');
      set({ errorMessage: msg, lastError: msg });
      return;
    }

    const request = buildPromptRequest(input, get().inputFiles, get().referenceUrl);
    if (!request) return;

    const generationId = newId();
    const history = get().messages;
    const isFirstPrompt = history.length === 0;
    set((s) => ({
      messages: [...s.messages, { role: 'user', content: request.prompt }],
      isGenerating: true,
      activeGenerationId: generationId,
      generationStage: 'sending',
      streamingTokenCount: 0,
      errorMessage: null,
      lastPromptInput: request,
      selectedElement: null,
      iframeErrors: [],
    }));

    triggerAutoRenameIfFirst(get, isFirstPrompt, request.prompt);

    try {
      await runGenerate(get, set, generationId, {
        prompt: request.prompt,
        history,
        model: modelRef(cfg.provider, cfg.modelPrimary),
        ...(request.referenceUrl ? { referenceUrl: request.referenceUrl } : {}),
        attachments: request.attachments,
        generationId,
      });
    } catch (err) {
      applyGenerateError(get, set, generationId, err);
    }
  },

  cancelGeneration() {
    const id = get().activeGenerationId;
    if (!id) return;
    if (!window.codesign) {
      const msg = tr('errors.rendererDisconnected');
      set({ errorMessage: msg, lastError: msg });
      get().pushToast({
        variant: 'error',
        title: tr('notifications.cancellationFailed'),
        description: msg,
      });
      return;
    }

    void window.codesign
      .cancelGeneration(id)
      .then(() => {
        finishIfCurrent(set, id, () => ({
          isGenerating: false,
          activeGenerationId: null,
          generationStage: 'idle' as GenerationStage,
        }));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        set({ errorMessage: msg, lastError: msg });
        get().pushToast({
          variant: 'error',
          title: tr('notifications.cancellationFailed'),
          description: msg,
        });
      });
  },

  async retryLastPrompt() {
    const lastPromptInput = get().lastPromptInput;
    if (!lastPromptInput) return;

    const messages = [...get().messages];
    const lastMessage = messages.at(-1);
    if (lastMessage?.role === 'assistant' && lastMessage.content.startsWith('Error:'))
      messages.pop();
    const maybeUser = messages.at(-1);
    if (maybeUser?.role === 'user' && maybeUser.content === lastPromptInput.prompt) messages.pop();

    set({ messages, errorMessage: null });
    await get().sendPrompt(lastPromptInput);
  },

  async applyInlineComment(comment) {
    const trimmed = comment.trim();
    if (!trimmed || get().isGenerating) return;
    if (!window.codesign) return;
    const cfg = get().config;
    const html = get().previewHtml;
    const selection = get().selectedElement;
    if (cfg === null || !cfg.hasKey || html === null || selection === null) return;

    const userMessage: ChatMessage = { role: 'user', content: `Edit ${selection.tag}: ${trimmed}` };
    const referenceUrl = normalizeReferenceUrl(get().referenceUrl);
    const attachments = uniqueFiles(get().inputFiles);

    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
      iframeErrors: [],
    }));

    try {
      const result = await window.codesign.applyComment({
        html,
        comment: trimmed,
        selection,
        ...(referenceUrl ? { referenceUrl } : {}),
        attachments,
      });
      const firstArtifact = result.artifacts[0];
      set((s) => ({
        messages: [
          ...s.messages,
          { role: 'assistant', content: result.message || tr('common.applied') },
        ],
        previewHtml: firstArtifact?.content ?? s.previewHtml,
        isGenerating: false,
        selectedElement: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${msg}` }],
        isGenerating: false,
        errorMessage: msg,
        lastError: msg,
      }));
      get().pushToast({
        variant: 'error',
        title: tr('notifications.inlineCommentFailed'),
        description: msg,
      });
    }
  },

  clearError() {
    set({ errorMessage: null });
  },

  async exportActive(format: ExportFormat) {
    const html = get().previewHtml;
    if (!html) {
      set({ toastMessage: tr('notifications.noDesignToExport') });
      return;
    }
    if (!window.codesign) {
      set({ errorMessage: tr('errors.rendererDisconnected') });
      return;
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = format === 'markdown' ? 'md' : format;
      const res = await window.codesign.export({
        format,
        htmlContent: html,
        defaultFilename: `codesign-${stamp}.${ext}`,
      });
      if (res.status === 'saved' && res.path) {
        set({ toastMessage: tr('notifications.exportedTo', { path: res.path }) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      set({ toastMessage: msg, errorMessage: msg, lastError: msg });
    }
  },

  selectCanvasElement(selection) {
    set({ selectedElement: selection });
  },

  clearCanvasElement() {
    set({ selectedElement: null });
  },

  setPreviewZoom(zoom) {
    set({ previewZoom: zoom });
  },

  setTheme(theme) {
    applyThemeClass(theme);
    persistTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setView(view) {
    set({ view, commandPaletteOpen: false });
  },

  setHubTab(tab) {
    set({ hubTab: tab });
  },

  openCreateProjectModal() {
    set({ createProjectModalOpen: true });
  },

  closeCreateProjectModal() {
    set({ createProjectModalOpen: false });
  },

  createProject(draft) {
    const now = new Date().toISOString();
    const project: Project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: newId(),
      name: draft.name.trim(),
      type: draft.type,
      createdAt: now,
      updatedAt: now,
      ...(draft.fidelity ? { fidelity: draft.fidelity } : {}),
      ...(draft.speakerNotes !== undefined ? { speakerNotes: draft.speakerNotes } : {}),
      ...(draft.templateId ? { templateId: draft.templateId } : {}),
    };
    const next = [project, ...get().projects];
    const persist = persistProjects(next);
    set({
      projects: next,
      currentProjectId: project.id,
      view: 'workspace',
      createProjectModalOpen: false,
      messages: [],
      previewHtml: null,
      inputFiles: [],
      referenceUrl: '',
      selectedElement: null,
      lastPromptInput: null,
      generationStage: 'idle' as GenerationStage,
      isGenerating: false,
      activeGenerationId: null,
      errorMessage: null,
      lastError: null,
    });
    if (persist.error) {
      get().pushToast({
        variant: 'error',
        title: tr('errors.projectStorageFailed'),
        description: persist.error,
      });
    }
    return project;
  },

  openProject(id) {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    set({
      currentProjectId: id,
      view: 'workspace',
      messages: [],
      previewHtml: null,
      inputFiles: [],
      referenceUrl: '',
      selectedElement: null,
      lastPromptInput: null,
      generationStage: 'idle' as GenerationStage,
      isGenerating: false,
      activeGenerationId: null,
      errorMessage: null,
      lastError: null,
    });
  },

  setPreviewViewport(viewport) {
    set({ previewViewport: viewport });
  },

  openCommandPalette() {
    set({ commandPaletteOpen: true });
  },
  closeCommandPalette() {
    set({ commandPaletteOpen: false });
  },

  async loadDesigns() {
    if (!window.codesign) return;
    try {
      const designs = await window.codesign.snapshots.listDesigns();
      set({ designs, designsLoaded: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.loadFailed'),
        description: msg,
      });
      set({ designsLoaded: true });
      throw err instanceof Error ? err : new Error(msg);
    }
  },

  async ensureCurrentDesign() {
    if (!window.codesign) return;
    await get().loadDesigns();
    const designs = get().designs;
    if (get().currentDesignId !== null) return;

    if (designs.length > 0) {
      const first = designs[0];
      if (first) await get().switchDesign(first.id);
      return;
    }
    // No designs exist yet — create the first one silently. The user can
    // rename it later or just send a prompt and we'll auto-name it.
    await get().createNewDesign();
  },

  async createNewDesign() {
    if (!window.codesign) return null;
    if (get().isGenerating) return null;
    const existingCount = get().designs.length;
    const name = `Untitled design ${existingCount + 1}`;
    try {
      const design = await window.codesign.snapshots.createDesign(name);
      set({
        currentDesignId: design.id,
        messages: [],
        previewHtml: null,
        errorMessage: null,
        iframeErrors: [],
        selectedElement: null,
        lastPromptInput: null,
        designsViewOpen: false,
      });
      await get().loadDesigns();
      return design;
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.createFailed'),
        description: msg,
      });
      return null;
    }
  },

  async switchDesign(id: string) {
    if (!window.codesign) return;
    if (get().isGenerating) {
      get().pushToast({
        variant: 'info',
        title: tr('projects.notifications.switchBlockedGenerating'),
      });
      return;
    }
    if (get().currentDesignId === id) {
      set({ designsViewOpen: false });
      return;
    }
    try {
      const [messages, snapshots] = await Promise.all([
        window.codesign.snapshots.listMessages(id),
        window.codesign.snapshots.list(id),
      ]);
      const latest = snapshots[0] ?? null;
      set({
        currentDesignId: id,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        previewHtml: latest ? latest.artifactSource : null,
        errorMessage: null,
        iframeErrors: [],
        selectedElement: null,
        lastPromptInput: null,
        designsViewOpen: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.switchFailed'),
        description: msg,
      });
    }
  },

  async renameCurrentDesign(name: string) {
    const id = get().currentDesignId;
    if (!id) return;
    await get().renameDesign(id, name);
  },

  async renameDesign(id: string, name: string) {
    if (!window.codesign) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await window.codesign.snapshots.renameDesign(id, trimmed);
      await get().loadDesigns();
      set({ designToRename: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.renameFailed'),
        description: msg,
      });
    }
  },

  async duplicateDesign(id: string) {
    if (!window.codesign) return null;
    const source = get().designs.find((d) => d.id === id);
    if (!source) return null;
    const name = tr('projects.duplicateNameTemplate', { name: source.name });
    try {
      const cloned = await window.codesign.snapshots.duplicateDesign(id, name);
      await get().loadDesigns();
      get().pushToast({
        variant: 'success',
        title: tr('projects.notifications.duplicated', { name: cloned.name }),
      });
      return cloned;
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.duplicateFailed'),
        description: msg,
      });
      return null;
    }
  },

  async softDeleteDesign(id: string) {
    if (!window.codesign) return;
    if (get().isGenerating) {
      get().pushToast({
        variant: 'info',
        title: tr('projects.notifications.deleteBlockedGenerating'),
      });
      return;
    }
    try {
      await window.codesign.snapshots.softDeleteDesign(id);
      const wasCurrent = get().currentDesignId === id;
      await get().loadDesigns();
      if (wasCurrent) {
        const remaining = get().designs;
        set({ currentDesignId: null, messages: [], previewHtml: null });
        if (remaining.length > 0 && remaining[0]) {
          await get().switchDesign(remaining[0].id);
        } else {
          await get().createNewDesign();
        }
      }
      set({ designToDelete: null });
      get().pushToast({ variant: 'info', title: tr('projects.notifications.deleted') });
    } catch (err) {
      const msg = err instanceof Error ? err.message : tr('errors.unknown');
      get().pushToast({
        variant: 'error',
        title: tr('projects.notifications.deleteFailed'),
        description: msg,
      });
    }
  },

  openDesignsView() {
    void get().loadDesigns();
    set({ designsViewOpen: true });
  },
  closeDesignsView() {
    set({ designsViewOpen: false });
  },
  requestDeleteDesign(design) {
    set({ designToDelete: design });
  },
  requestRenameDesign(design) {
    set({ designToRename: design });
  },

  pushToast(toast) {
    const id = newId();
    const next: Toast = { id, ...toast };
    set((s) => ({ toasts: [...s.toasts, next] }));
    return id;
  },

  dismissToast(id?: string) {
    if (id === undefined) {
      set({ toastMessage: null });
      return;
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

if (initialProjectsRead.error && typeof window !== 'undefined') {
  // Defer so i18n + UI have a chance to mount before the toast renders.
  setTimeout(() => {
    useCodesignStore.getState().pushToast({
      variant: 'error',
      title: tr('errors.projectStorageFailed'),
      description: initialProjectsRead.error ?? '',
    });
  }, 0);
}
