import {
  type ChatAppendInput,
  type ChatMessageRow,
  type ChatToolCallPayload,
  LEGACY_SOURCE_ENTRY,
} from '@open-codesign/shared';
import {
  hasWorkspaceSourceReference,
  inferPreviewSourcePath,
  resolveDesignPreviewSource,
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

const CHAT_UI_ROW_LIMIT = 220;
const CHAT_UI_TEXT_LIMIT = 20_000;
const CHAT_UI_TOOL_TEXT_LIMIT = 1_200;
const CHAT_UI_DETAIL_LIMIT = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncateForUi(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function compactLargeStringFields(value: unknown, limit: number): unknown {
  if (typeof value === 'string') return truncateForUi(value, limit);
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => compactLargeStringFields(item, limit));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'screenshot' || key === 'imageDataUrl' || key === 'dataUrl') {
      out[key] = '[stripped for UI]';
      continue;
    }
    out[key] = compactLargeStringFields(item, limit);
  }
  return out;
}

function compactDetailsForUi(details: unknown): unknown {
  if (!isRecord(details)) return details;
  const compacted = compactLargeStringFields(details, CHAT_UI_TOOL_TEXT_LIMIT);
  if (jsonSize(compacted) <= CHAT_UI_DETAIL_LIMIT) return compacted;

  const summary: Record<string, unknown> = {
    summarized: true,
    keys: Object.keys(details).slice(0, 12),
  };
  for (const key of [
    'command',
    'path',
    'name',
    'status',
    'reason',
    'ok',
    'summary',
    'errorCount',
    'kind',
    'destPath',
    'bytes',
  ]) {
    const value = details[key];
    if (value !== undefined)
      summary[key] = compactLargeStringFields(value, CHAT_UI_TOOL_TEXT_LIMIT);
  }
  return summary;
}

function compactToolResultForUi(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const content = result['content'];
  const compactedContent = Array.isArray(content)
    ? content.slice(0, 8).map((item) => {
        if (!isRecord(item) || item['type'] !== 'text' || typeof item['text'] !== 'string') {
          return compactLargeStringFields(item, CHAT_UI_TOOL_TEXT_LIMIT);
        }
        return { ...item, text: truncateForUi(item['text'], CHAT_UI_TOOL_TEXT_LIMIT) };
      })
    : undefined;
  return {
    ...result,
    ...(compactedContent !== undefined ? { content: compactedContent } : {}),
    ...(result['details'] !== undefined ? { details: compactDetailsForUi(result['details']) } : {}),
  };
}

function compactChatRowForUi(row: ChatMessageRow): ChatMessageRow {
  if (row.kind === 'tool_call') {
    const payload = isRecord(row.payload) ? (row.payload as unknown as ChatToolCallPayload) : null;
    if (payload === null) return row;
    return {
      ...row,
      payload: {
        ...payload,
        ...(payload.result !== undefined ? { result: compactToolResultForUi(payload.result) } : {}),
        ...(payload.error?.message !== undefined
          ? {
              error: {
                ...payload.error,
                message: truncateForUi(payload.error.message, CHAT_UI_TEXT_LIMIT),
              },
            }
          : {}),
      },
    };
  }

  if (!isRecord(row.payload) || typeof row.payload['text'] !== 'string') return row;
  return {
    ...row,
    payload: {
      ...row.payload,
      text: truncateForUi(row.payload['text'], CHAT_UI_TEXT_LIMIT),
    },
  };
}

export function compactChatRowsForUi(rows: ChatMessageRow[]): ChatMessageRow[] {
  return rows.slice(-CHAT_UI_ROW_LIMIT).map(compactChatRowForUi);
}

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
        set({ chatMessages: compactChatRowsForUi(rows), chatLoaded: true });
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
          set((s) => ({ chatMessages: compactChatRowsForUi([...s.chatMessages, row]) }));
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
        chatMessages: compactChatRowsForUi(
          s.chatMessages.map((m) => {
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
        ),
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
      const isCurrentDesign = state.currentDesignId === designId;
      let source = isCurrentDesign
        ? state.previewSource
        : (state.previewSourceByDesign[designId] ?? null);
      let resolved: { content: string; path: string };
      if (source && source.trim().length > 0) {
        const referencesWorkspaceSource = hasWorkspaceSourceReference(source, LEGACY_SOURCE_ENTRY);
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
      } else {
        const workspaceResult = await resolveDesignPreviewSource({
          designId,
          read: window.codesign.files?.read,
        });
        if (workspaceResult === null) return;
        resolved = workspaceResult;
        source = workspaceResult.content;
      }
      const artifactContent = resolved.content;
      if (artifactContent !== source) {
        const pool = recordPreviewSourceInPool(
          get().previewSourceByDesign,
          get().recentDesignIds,
          designId,
          artifactContent,
        );
        set((current) => ({
          ...(current.currentDesignId === designId ? { previewSource: artifactContent } : {}),
          previewSourceByDesign: pool.cache,
          recentDesignIds: pool.recent,
        }));
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
