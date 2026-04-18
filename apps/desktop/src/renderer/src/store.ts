import { i18n } from '@open-codesign/i18n';
import type {
  ChatMessage,
  LocalInputFile,
  ModelRef,
  OnboardingState,
  SelectedElement,
  SupportedOnboardingProvider,
} from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi, ExportFormat } from '../../preload/index';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

export type Theme = 'light' | 'dark';

interface PromptRequest {
  prompt: string;
  attachments: LocalInputFile[];
  referenceUrl?: string | undefined;
}

interface CodesignState {
  messages: ChatMessage[];
  previewHtml: string | null;
  isGenerating: boolean;
  errorMessage: string | null;
  lastError: string | null;
  config: OnboardingState | null;
  configLoaded: boolean;
  toastMessage: string | null;

  theme: Theme;
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  toasts: Toast[];
  iframeErrors: string[];

  inputFiles: LocalInputFile[];
  referenceUrl: string;
  lastPromptInput: PromptRequest | null;
  selectedElement: SelectedElement | null;

  loadConfig: () => Promise<void>;
  completeOnboarding: (next: OnboardingState) => void;
  sendPrompt: (input: {
    prompt: string;
    attachments?: LocalInputFile[] | undefined;
    referenceUrl?: string | undefined;
  }) => Promise<void>;
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

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id?: string) => void;
}

const THEME_STORAGE_KEY = 'open-codesign:theme';

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

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  lastError: null,
  config: null,
  configLoaded: false,
  toastMessage: null,

  theme: readInitialTheme(),
  settingsOpen: false,
  commandPaletteOpen: false,
  toasts: [],
  iframeErrors: [],

  inputFiles: [],
  referenceUrl: '',
  lastPromptInput: null,
  selectedElement: null,

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
  },

  completeOnboarding(next: OnboardingState) {
    set({ config: next });
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
    if (cfg === null || !cfg.hasKey || cfg.provider === null || cfg.modelPrimary === null) {
      const msg = tr('errors.onboardingIncomplete');
      set({ errorMessage: msg, lastError: msg });
      return;
    }

    const prompt = input.prompt.trim();
    if (!prompt) return;

    const request: PromptRequest = {
      prompt,
      attachments: uniqueFiles(input.attachments ?? get().inputFiles),
      ...(normalizeReferenceUrl(input.referenceUrl ?? get().referenceUrl)
        ? { referenceUrl: normalizeReferenceUrl(input.referenceUrl ?? get().referenceUrl) }
        : {}),
    };

    const history = get().messages;
    const userMessage: ChatMessage = { role: 'user', content: prompt };
    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
      lastPromptInput: request,
      selectedElement: null,
      iframeErrors: [],
    }));

    try {
      const result = await window.codesign.generate({
        prompt,
        history,
        model: modelRef(cfg.provider, cfg.modelPrimary),
        ...(request.referenceUrl ? { referenceUrl: request.referenceUrl } : {}),
        attachments: request.attachments,
      });
      const firstArtifact = result.artifacts[0];
      set((s) => ({
        messages: [
          ...s.messages,
          { role: 'assistant', content: result.message || tr('common.done') },
        ],
        previewHtml: firstArtifact?.content ?? s.previewHtml,
        isGenerating: false,
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
        title: tr('notifications.generationFailed'),
        description: msg,
      });
    }
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
      const res = await window.codesign.export({
        format,
        htmlContent: html,
        defaultFilename: `codesign-${stamp}.${format}`,
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

  setTheme(theme) {
    applyThemeClass(theme);
    persistTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  openSettings() {
    set({ settingsOpen: true, commandPaletteOpen: false });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },

  openCommandPalette() {
    set({ commandPaletteOpen: true, settingsOpen: false });
  },
  closeCommandPalette() {
    set({ commandPaletteOpen: false });
  },

  pushToast(toast) {
    const id = newId();
    const next: Toast = { id, ...toast };
    set((s) => ({ toasts: [...s.toasts, next] }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        get().dismissToast(id);
      }, 4000);
    }
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
