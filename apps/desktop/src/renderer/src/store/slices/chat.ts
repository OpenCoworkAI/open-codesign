import {
  type ChatAppendInput,
  type ChatToolCallPayload,
  LEGACY_SOURCE_ENTRY,
} from '@open-codesign/shared';
import {
  hasWorkspaceSourceReference,
  inferPreviewSourcePath,
  resolveWorkspacePreviewSource,
} from '../../preview/workspace-source.js';
import type { CodesignState } from '../../store.js';
import { looksRunnableArtifact } from '../lib/artifact.js';
import { tr } from '../lib/locale.js';
import {
  type PersistArtifact,
  persistArtifactSnapshot,
  recordPreviewSourceInPool,
} from './snapshots.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

interface ChatSliceActions {
  loadChatForCurrentDesign: CodesignState['loadChatForCurrentDesign'];
  appendChatMessage: CodesignState['appendChatMessage'];
  clearChatLocal: CodesignState['clearChatLocal'];
  setStreamingAssistantText: CodesignState['setStreamingAssistantText'];
  pushPendingToolCall: CodesignState['pushPendingToolCall'];
  resolvePendingToolCall: CodesignState['resolvePendingToolCall'];
  updateChatToolStatus: CodesignState['updateChatToolStatus'];
  setPreviewSourceFromAgent: CodesignState['setPreviewSourceFromAgent'];
  setPreviewSource: CodesignState['setPreviewSource'];
  persistAgentRunSnapshot: CodesignState['persistAgentRunSnapshot'];
}

export function makeChatSlice(set: SetState, get: GetState): ChatSliceActions {
  return {
    async loadChatForCurrentDesign() {
      if (!window.codesign) return;
      const designId = get().currentDesignId;
      if (!designId) {
        set({ chatMessages: [], chatLoaded: true });
        return;
      }
      try {
        // Seed existing designs' chat history from snapshots on first open.
        await window.codesign.chat.seedFromSnapshots(designId);
        const rows = await window.codesign.chat.list(designId);
        // Guard against a design switch happening while the IPC was in flight —
        // we'd otherwise render the previous design's chat into the new one.
        if (get().currentDesignId !== designId) return;
        set({ chatMessages: rows, chatLoaded: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        console.warn('[open-codesign] loadChatForCurrentDesign failed:', msg);
        set({ chatLoaded: true });
      }
    },

    async appendChatMessage(input: ChatAppendInput) {
      if (!window.codesign) return null;
      try {
        const row = await window.codesign.chat.append(input);
        // Only merge into state if the append belongs to the current design —
        // a background append to a previous design must not pollute the view.
        if (get().currentDesignId === input.designId) {
          set((s) => ({ chatMessages: [...s.chatMessages, row] }));
        }
        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        console.warn('[open-codesign] appendChatMessage failed:', msg);
        return null;
      }
    },

    clearChatLocal() {
      set({ chatMessages: [], chatLoaded: false });
    },

    setStreamingAssistantText(value) {
      if (value === null) {
        set({ streamingAssistantText: null, streamingAssistantTextByDesign: {} });
        return;
      }
      set((s) => {
        const streamingAssistantTextByDesign = { ...s.streamingAssistantTextByDesign };
        if (value.text.length > 0) {
          streamingAssistantTextByDesign[value.designId] = value.text;
        } else {
          delete streamingAssistantTextByDesign[value.designId];
        }
        return {
          streamingAssistantText:
            value.text.length > 0
              ? value
              : s.streamingAssistantText?.designId === value.designId
                ? null
                : s.streamingAssistantText,
          streamingAssistantTextByDesign,
        };
      });
    },

    pushPendingToolCall(designId, call) {
      if (get().currentDesignId !== designId) return;
      set((s) => ({ pendingToolCalls: [...s.pendingToolCalls, call] }));
    },

    resolvePendingToolCall(designId, toolName, result, durationMs) {
      const s = get();
      const idx = s.pendingToolCalls.findIndex(
        (c) => c.toolName === toolName && c.status === 'running',
      );
      const resolved = idx >= 0 ? s.pendingToolCalls[idx] : null;
      // Remove from pending
      if (idx >= 0) {
        const next = [...s.pendingToolCalls];
        next.splice(idx, 1);
        set({ pendingToolCalls: next });
      }
      // Persist the completed tool call to session JSONL.
      if (resolved) {
        void get().appendChatMessage({
          designId,
          kind: 'tool_call',
          payload: {
            ...resolved,
            status: 'done' as const,
            ...(result !== undefined ? { result } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
          },
        });
      }
    },

    async updateChatToolStatus({ designId, seq, status, result, durationMs, errorMessage }) {
      if (!window.codesign) return;
      try {
        await window.codesign.chat.updateToolStatus({
          designId,
          seq,
          status,
          ...(result !== undefined ? { result } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        console.warn('[open-codesign] updateChatToolStatus failed:', msg);
        return;
      }
      // Mirror the patch into local chatMessages so WorkingCard re-renders
      // immediately without waiting for a list reload.
      if (get().currentDesignId !== designId) return;
      set((s) => ({
        chatMessages: s.chatMessages.map((m) => {
          if (m.designId !== designId || m.seq !== seq || m.kind !== 'tool_call') return m;
          const prev = (m.payload as ChatToolCallPayload | null) ?? null;
          if (!prev) return m;
          const nextPayload: ChatToolCallPayload = {
            ...prev,
            status,
            ...(result !== undefined ? { result } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(errorMessage !== undefined ? { error: { message: errorMessage } } : {}),
          };
          return { ...m, payload: nextPayload };
        }),
      }));
    },

    setPreviewSourceFromAgent({ designId, content }) {
      const state = get();
      // Only adopt the live source when the event's design is visible. This
      // prevents a background run on design A from blowing away the preview
      // while the user has switched to design B.
      if (state.currentDesignId !== designId) {
        // The event's design isn't visible — still update its pool entry so
        // switching back later reflects the streamed-in source.
        const pool = recordPreviewSourceInPool(
          state.previewSourceByDesign,
          state.recentDesignIds,
          designId,
          content,
        );
        set({ previewSourceByDesign: pool.cache, recentDesignIds: pool.recent });
        return;
      }
      const pool = recordPreviewSourceInPool(
        state.previewSourceByDesign,
        state.recentDesignIds,
        designId,
        content,
      );
      set({
        previewSource: content,
        previewSourceByDesign: pool.cache,
        recentDesignIds: pool.recent,
      });
    },

    setPreviewSource(content: string) {
      const state = get();
      if (state.currentDesignId === null) {
        set({ previewSource: content });
        return;
      }
      const pool = recordPreviewSourceInPool(
        state.previewSourceByDesign,
        state.recentDesignIds,
        state.currentDesignId,
        content,
      );
      set({
        previewSource: content,
        previewSourceByDesign: pool.cache,
        recentDesignIds: pool.recent,
      });
    },

    async persistAgentRunSnapshot({ designId, finalText }) {
      if (!window.codesign) return;
      const state = get();
      // Don't write a snapshot if the run produced nothing renderable, or if
      // the user has already navigated to a different design (we'd persist the
      // wrong source otherwise).
      if (state.currentDesignId !== designId) return;
      const source = state.previewSource;
      if (!source || source.trim().length === 0) return;
      const referencesWorkspaceSource = hasWorkspaceSourceReference(source, LEGACY_SOURCE_ENTRY);
      let resolved: { content: string; path: string };
      try {
        resolved = await resolveWorkspacePreviewSource({
          designId,
          source,
          path: referencesWorkspaceSource ? LEGACY_SOURCE_ENTRY : inferPreviewSourcePath(source),
          read: window.codesign.files?.read,
          requireReferencedSource: referencesWorkspaceSource,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.snapshotSkipped'),
          description: msg,
        });
        return;
      }
      if (get().currentDesignId !== designId) return;
      const artifactContent = resolved.content;
      if (artifactContent !== source) {
        const pool = recordPreviewSourceInPool(
          get().previewSourceByDesign,
          get().recentDesignIds,
          designId,
          artifactContent,
        );
        set({
          previewSource: artifactContent,
          previewSourceByDesign: pool.cache,
          recentDesignIds: pool.recent,
        });
      }
      // Guard against persisting truncated artifacts. When an agent run is
      // interrupted mid-edit (context explosion, 400 response, cancel, crash),
      // the virtual-FS has a partial JSX file that would overwrite the last
      // good snapshot and render as a blank card in the hub. Require a
      // ReactDOM.createRoot mount call + roughly balanced braces; if missing,
      // keep the last good snapshot and warn the user.
      if (!looksRunnableArtifact(artifactContent)) {
        get().pushToast({
          variant: 'info',
          title: tr('projects.notifications.snapshotSkipped'),
          description: tr('projects.notifications.snapshotSkippedBody'),
        });
        return;
      }
      // The "prompt" associated with this snapshot is the most recent user
      // message in the chat — that is what the agent was answering.
      const lastUser = [...state.chatMessages].reverse().find((m) => m.kind === 'user');
      const prompt = (lastUser?.payload as { text?: string } | undefined)?.text ?? null;
      const artifact: PersistArtifact = {
        type: 'html',
        content: artifactContent,
        prompt,
        message: finalText && finalText.length > 0 ? finalText : null,
      };
      try {
        const newSnapshotId = await persistArtifactSnapshot(designId, artifact);
        // Refresh the design list so the hub thumbnail / updated_at land on
        // disk for the next ensureCurrentDesign() boot.
        await get().loadDesigns();
        if (newSnapshotId && get().currentDesignId === designId) {
          set({ currentSnapshotId: newSnapshotId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.saveFailed'),
          description: msg,
        });
      }
    },
  };
}
