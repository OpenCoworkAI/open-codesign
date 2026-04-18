import type { ChatMessage } from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi } from '../../preload/index';

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

  theme: Theme;
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  toasts: Toast[];

  sendPrompt: (prompt: string) => Promise<void>;
  retryLastPrompt: () => Promise<void>;
  clearError: () => void;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  pushToast: (toast: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
}

const THEME_STORAGE_KEY = 'open-codesign:theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

function applyThemeClass(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

function persistTheme(theme: Theme) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  lastError: null,

  theme: readInitialTheme(),
  settingsOpen: false,
  commandPaletteOpen: false,
  toasts: [],

  async sendPrompt(prompt: string) {
    if (get().isGenerating) return;
    if (!window.codesign) {
      const msg = 'Renderer is not connected to the main process.';
      set({ errorMessage: msg, lastError: msg });
      get().pushToast({ variant: 'error', title: 'Generation failed', description: msg });
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: prompt };
    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
    }));

    const apiKey = '';
    if (!apiKey) {
      set((s) => ({
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content:
              'No API key configured yet. Onboarding flow coming in v0.1 — see docs/research/06-api-onboarding-ux.md.',
          },
        ],
        isGenerating: false,
      }));
      return;
    }

    try {
      const result = await window.codesign.generate({
        prompt,
        history: get().messages,
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
        apiKey,
      });
      const firstArtifact = (result as { artifacts: Array<{ content: string }> }).artifacts[0];
      const message = (result as { message: string }).message;
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: message || 'Done.' }],
        previewHtml: firstArtifact?.content ?? s.previewHtml,
        isGenerating: false,
      }));
      get().pushToast({ variant: 'success', title: 'Design ready' });
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
    set({ errorMessage: null });
    await get().sendPrompt(lastUser.content);
  },

  clearError() {
    set({ errorMessage: null });
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

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
