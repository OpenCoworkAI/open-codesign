import { type Locale, setLocale as applyLocale, normalizeLocale } from '@open-codesign/i18n';
import type { ChatMessage } from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi } from '../../preload/index';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

interface CodesignState {
  messages: ChatMessage[];
  previewHtml: string | null;
  isGenerating: boolean;
  errorMessage: string | null;
  locale: Locale;
  initLocale: () => Promise<void>;
  setLocale: (locale: string) => Promise<void>;
  sendPrompt: (prompt: string) => Promise<void>;
}

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  locale: 'en',

  async initLocale() {
    if (!window.codesign) return;
    const raw = await window.codesign.locale.getCurrent();
    const normalized = normalizeLocale(raw);
    await applyLocale(normalized);
    set({ locale: normalized });
  },

  async setLocale(locale: string) {
    const normalized = await applyLocale(locale);
    set({ locale: normalized });
    if (window.codesign) {
      await window.codesign.locale.set(normalized);
    }
  },

  async sendPrompt(prompt: string) {
    if (get().isGenerating) return;
    if (!window.codesign) {
      set({ errorMessage: 'Renderer is not connected to the main process.' });
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: prompt };
    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
    }));

    // Tier 1 wiring: hardcoded provider/model and key-from-env until the
    // onboarding flow lands. The real flow will read from the keychain.
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${msg}` }],
        isGenerating: false,
        errorMessage: msg,
      }));
    }
  },
}));
