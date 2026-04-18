import type {
  ChatMessage,
  ModelRef,
  OnboardingState,
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

  loadConfig: () => Promise<void>;
  completeOnboarding: (next: OnboardingState) => void;
  sendPrompt: (prompt: string) => Promise<void>;
  retryLastPrompt: () => Promise<void>;
  clearError: () => void;
  exportActive: (format: ExportFormat) => Promise<void>;

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

  async loadConfig() {
    if (!window.codesign) {
      set({
        configLoaded: true,
        errorMessage: 'Renderer is not connected to the main process.',
      });
      return;
    }
    const state = await window.codesign.onboarding.getState();
    set({ config: state, configLoaded: true });
  },

  completeOnboarding(next: OnboardingState) {
    set({ config: next });
  },

  async sendPrompt(prompt: string) {
    if (get().isGenerating) return;
    if (!window.codesign) {
      const msg = 'Renderer is not connected to the main process.';
      set({ errorMessage: msg, lastError: msg });
      return;
    }
    const cfg = get().config;
    if (cfg === null || !cfg.hasKey || cfg.provider === null || cfg.modelPrimary === null) {
      const msg = 'Onboarding is not complete.';
      set({ errorMessage: msg, lastError: msg });
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: prompt };
    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
    }));

    try {
      const result = await window.codesign.generate({
        prompt,
        history: get().messages,
        model: modelRef(cfg.provider, cfg.modelPrimary),
      });
      const firstArtifact = (result as { artifacts: Array<{ content: string }> }).artifacts[0];
      const message = (result as { message: string }).message;
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: message || 'Done.' }],
        previewHtml: firstArtifact?.content ?? s.previewHtml,
        isGenerating: false,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${msg}` }],
        isGenerating: false,
        errorMessage: msg,
        lastError: msg,
      }));
      get().pushToast({ variant: 'error', title: 'Generation failed', description: msg });
    }
  },

  async retryLastPrompt() {
    const lastUser = [...get().messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    set((s) => ({
      messages: s.messages.filter(
        (m) => m !== lastUser && !(m.role === 'assistant' && m.content.startsWith('Error:')),
      ),
      errorMessage: null,
    }));
    await get().sendPrompt(lastUser.content);
  },

  clearError() {
    set({ errorMessage: null });
  },

  async exportActive(format: ExportFormat) {
    const html = get().previewHtml;
    if (!html) {
      set({ toastMessage: 'No design to export yet.' });
      return;
    }
    if (!window.codesign) {
      set({ errorMessage: 'Renderer is not connected to the main process.' });
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
        set({ toastMessage: `Exported to ${res.path}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      set({ toastMessage: msg, errorMessage: msg, lastError: msg });
    }
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
