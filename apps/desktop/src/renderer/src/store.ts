import type { ChatMessage } from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi, ExportFormat } from '../../preload/index';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

// TIER 1 / DEV ONLY. The renderer reads `VITE_OPEN_CODESIGN_DEV_KEY` so the
// "first demo" path works before `wt/onboarding` lands real keychain plumbing.
// Once onboarding ships, this constant + the !apiKey branch in sendPrompt go
// away in the integration commit. Vite inlines `import.meta.env.*` at build
// time, so a missing var resolves to `undefined`.
const DEV_API_KEY: string =
  (import.meta.env['VITE_OPEN_CODESIGN_DEV_KEY'] as string | undefined) ?? '';

interface CodesignState {
  messages: ChatMessage[];
  previewHtml: string | null;
  isGenerating: boolean;
  errorMessage: string | null;
  toastMessage: string | null;
  sendPrompt: (prompt: string) => Promise<void>;
  exportActive: (format: ExportFormat) => Promise<void>;
  dismissToast: () => void;
}

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  toastMessage: null,

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

    const apiKey = DEV_API_KEY;
    if (!apiKey) {
      set((s) => ({
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content:
              'No API key configured yet. Set VITE_OPEN_CODESIGN_DEV_KEY for dev, or wait for the onboarding flow (wt/onboarding) to land.',
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
      set({ toastMessage: msg, errorMessage: msg });
    }
  },

  dismissToast() {
    set({ toastMessage: null });
  },
}));
