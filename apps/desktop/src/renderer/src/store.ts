import type { ChatMessage } from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi } from '../../preload/index';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

export interface StatusLine {
  /** Monotonic id for React key. */
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

interface CodesignState {
  messages: ChatMessage[];
  statusLines: StatusLine[];
  previewHtml: string | null;
  isGenerating: boolean;
  errorMessage: string | null;
  /** Tracks the user's intent to cancel; preload IPC is fire-and-forget so
   * the main-process call may still complete, but the renderer discards
   * the result and immediately leaves `isGenerating`. */
  currentAbortController: AbortController | null;
  /** Latest iframe runtime errors forwarded from the sandbox overlay. */
  iframeErrors: string[];
  /** Epoch ms until which the chat input is rate-limited (429). */
  rateLimitedUntil: number | null;

  sendPrompt: (prompt: string) => Promise<void>;
  cancelGeneration: () => void;
  appendIframeError: (msg: string) => void;
  clearIframeErrors: () => void;
  appendStatus: (text: string, kind?: StatusLine['kind']) => void;
  clearRateLimit: () => void;
}

let statusCounter = 0;

export const useCodesignStore = create<CodesignState>((set, get) => ({
  messages: [],
  statusLines: [],
  previewHtml: null,
  isGenerating: false,
  errorMessage: null,
  currentAbortController: null,
  iframeErrors: [],
  rateLimitedUntil: null,

  appendStatus(text, kind = 'info') {
    const line: StatusLine = { id: ++statusCounter, text, kind };
    set((s) => ({ statusLines: [...s.statusLines, line].slice(-20) }));
  },

  appendIframeError(msg) {
    set((s) => ({ iframeErrors: [...s.iframeErrors, msg].slice(-20) }));
  },

  clearIframeErrors() {
    set({ iframeErrors: [] });
  },

  clearRateLimit() {
    set({ rateLimitedUntil: null });
  },

  cancelGeneration() {
    const ctrl = get().currentAbortController;
    if (!ctrl) return;
    ctrl.abort();
    set((s) => ({
      isGenerating: false,
      currentAbortController: null,
      messages: [...s.messages, { role: 'assistant', content: 'Generation cancelled by user.' }],
    }));
    get().appendStatus('Generation cancelled', 'warn');
  },

  async sendPrompt(prompt: string) {
    if (get().isGenerating) return;
    if (!window.codesign) {
      set({ errorMessage: 'Renderer is not connected to the main process.' });
      return;
    }
    if (get().rateLimitedUntil !== null && Date.now() < (get().rateLimitedUntil ?? 0)) {
      get().appendStatus('Still rate-limited; switch model or wait.', 'warn');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: prompt };
    const controller = new AbortController();
    set((s) => ({
      messages: [...s.messages, userMessage],
      isGenerating: true,
      errorMessage: null,
      currentAbortController: controller,
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
        currentAbortController: null,
      }));
      return;
    }

    try {
      const promise = window.codesign.generate({
        prompt,
        history: get().messages,
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
        apiKey,
      });
      // Race the IPC promise against the abort signal — when the user
      // cancels, we resolve immediately and discard whatever comes back.
      const result = await Promise.race([
        promise,
        new Promise<'__cancelled'>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve('__cancelled'), {
            once: true,
          });
        }),
      ]);
      if (result === '__cancelled') return;
      if (controller.signal.aborted) return;

      const firstArtifact = (result as { artifacts: Array<{ content: string }> }).artifacts[0];
      const message = (result as { message: string }).message;
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: message || 'Done.' }],
        previewHtml: firstArtifact?.content ?? s.previewHtml,
        isGenerating: false,
        currentAbortController: null,
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // Detect rate-limit error pattern from the IPC string (the main-process
      // CodesignError message preserves status when available).
      const rateLimitMatch = /\b429\b|rate.?limit/i.exec(msg);
      const retryAfterMatch = /retry.?after[^0-9]*(\d+)/i.exec(msg);
      if (rateLimitMatch) {
        const seconds = retryAfterMatch?.[1] ? Number(retryAfterMatch[1]) : 30;
        const until = Date.now() + seconds * 1000;
        set({ rateLimitedUntil: until });
        get().appendStatus(`Rate limited for ${seconds}s — switch model to keep going.`, 'error');
      }
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${msg}` }],
        isGenerating: false,
        errorMessage: msg,
        currentAbortController: null,
      }));
    }
  },
}));
