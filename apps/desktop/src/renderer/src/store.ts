import type {
  ChatMessage,
  ModelRef,
  OnboardingState,
  SupportedOnboardingProvider,
} from '@open-codesign/shared';
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
  config: OnboardingState | null;
  configLoaded: boolean;
  loadConfig: () => Promise<void>;
  completeOnboarding: (next: OnboardingState) => void;
  sendPrompt: (prompt: string) => Promise<void>;
}

function modelRef(provider: SupportedOnboardingProvider, modelId: string): ModelRef {
  return { provider, modelId };
}

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  config: null,
  configLoaded: false,

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
      set({ errorMessage: 'Renderer is not connected to the main process.' });
      return;
    }
    const cfg = get().config;
    if (cfg === null || !cfg.hasKey || cfg.provider === null || cfg.modelPrimary === null) {
      set({ errorMessage: 'Onboarding is not complete.' });
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
      }));
    }
  },
}));
