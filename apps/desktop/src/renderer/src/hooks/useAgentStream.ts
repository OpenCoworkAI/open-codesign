/**
 * Listens for agent:event:v1 IPC events and fans them into the store.
 *
 * Text deltas are buffered into `streamingAssistantText` so the sidebar
 * chat renders an ephemeral bubble that grows as the model streams.
 * On turn_end the bubble is cleared — `appendChatMessage` persists the
 * final assistant_text row which then replaces the transient view.
 *
 * Tool events are persisted as tool_call chat rows at start time with
 * status='running'; tool_call_result then patches the row to 'done' / 'error'
 * via `chat:update-tool-status:v1`. turn_end is a defensive backstop that
 * marks any still-pending row as 'done' so the WorkingCard never sticks.
 */

import { DEFAULT_SOURCE_ENTRY, LEGACY_SOURCE_ENTRY } from '@open-codesign/shared';
import { useEffect, useRef } from 'react';
import type { AgentStreamEvent } from '../../../preload/index';
import { resolveReferencedWorkspacePreviewPath } from '../preview/workspace-source';
import { useCodesignStore } from '../store';
import { coerceUsageSnapshot } from '../store/slices/usage';
import { createAgentFsUpdateScheduler } from './agent-stream-fs-scheduler';
import { attachRunEvents } from './run-event-attachment';

interface PendingPersist {
  /** Resolves to the persisted row's seq, or null if the append failed. */
  seqPromise: Promise<number | null>;
  toolName: string;
  toolCallId: string | undefined;
  resolved: boolean;
}

interface InFlightTurn {
  designId: string;
  /** Matches the generationId from agent:event:v1 — guaranteed non-empty since
   *  AgentStreamEvent.generationId is required as of schema v1. */
  generationId: string;
  textBuffer: string;
  /** Final assistant text persisted on the previous turn_end of this run.
   *  pi-agent-core can re-emit the same trailing assistant prose across
   *  consecutive turns (e.g. tool turn → wrap-up turn that repeats the
   *  summary); we keep one copy. */
  lastPersistedText: string | null;
  /** Tool calls persisted as 'running' but whose result event hasn't
   *  arrived yet. Drained at tool_call_result and any leftovers are flipped
   *  to 'done' at turn_end. */
  pendingTools: PendingPersist[];
}

export function useAgentStream(): void {
  const appendChatMessage = useCodesignStore((s) => s.appendChatMessage);
  const setStreamingAssistantText = useCodesignStore((s) => s.setStreamingAssistantText);
  const setPreviewSourceFromAgent = useCodesignStore((s) => s.setPreviewSourceFromAgent);
  const updateChatToolStatus = useCodesignStore((s) => s.updateChatToolStatus);
  const persistAgentRunSnapshot = useCodesignStore((s) => s.persistAgentRunSnapshot);
  const renameDesign = useCodesignStore((s) => s.renameDesign);
  const markGenerationRunning = useCodesignStore((s) => s.markGenerationRunning);
  const forgetCancelledGeneration = useCodesignStore((s) => s.forgetCancelledGeneration);
  const inFlight = useRef<Map<string, InFlightTurn>>(new Map());

  const FS_THROTTLE_MS = 250;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.codesign) return;
    const fsScheduler = createAgentFsUpdateScheduler({
      delayMs: FS_THROTTLE_MS,
      setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimer: (timer) => clearTimeout(timer),
      flush(update) {
        if (useCodesignStore.getState().cancelledGenerationIds.has(update.generationId)) {
          return;
        }
        setPreviewSourceFromAgent({
          designId: update.designId,
          content: update.content,
        });
      },
    });

    const scheduleFs = (next: {
      designId: string;
      generationId: string;
      path: string;
      content: string;
    }) => {
      fsScheduler.schedule(next);
    };

    const handleTurnStart = (event: AgentStreamEvent) => {
      markGenerationRunning(event.designId, event.generationId, 'thinking');
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_start', {
        generationId: event.generationId,
        designId: event.designId,
      });
      const previous = inFlight.current.get(event.generationId);
      inFlight.current.set(event.generationId, {
        designId: event.designId,
        generationId: event.generationId,
        textBuffer: '',
        lastPersistedText: previous?.lastPersistedText ?? null,
        pendingTools: previous?.pendingTools ?? [],
      });
      setStreamingAssistantText({ designId: event.designId, text: '' });
    };

    const handleTextDelta = (event: AgentStreamEvent) => {
      markGenerationRunning(event.designId, event.generationId, 'streaming');
      const current = inFlight.current.get(event.generationId);
      if (!current || typeof event.delta !== 'string') return;
      current.textBuffer += event.delta;
      setStreamingAssistantText({
        designId: current.designId,
        text: current.textBuffer,
      });
    };

    const drainPendingTools = (current: InFlightTurn, finalStatus: 'done' | 'error'): void => {
      const designId = current.designId;
      const stragglers = current.pendingTools.filter((p) => !p.resolved);
      current.pendingTools = current.pendingTools.filter((p) => p.resolved);
      for (const p of stragglers) {
        p.resolved = true;
        void p.seqPromise.then((seq) => {
          if (seq === null) return;
          void updateChatToolStatus({ designId, seq, status: finalStatus });
        });
      }
    };

    const handleTurnEnd = (event: AgentStreamEvent) => {
      markGenerationRunning(event.designId, event.generationId, 'thinking');
      const current = inFlight.current.get(event.generationId);
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_end', {
        generationId: event.generationId,
        designId: event.designId,
        textLen: (event.finalText ?? current?.textBuffer ?? '').length,
      });
      const finalText = event.finalText ?? current?.textBuffer ?? '';
      const trimmed = finalText.trim();
      if (current && trimmed.length > 0 && trimmed !== current.lastPersistedText?.trim()) {
        useCodesignStore.setState((state) => {
          const run = state.generationByDesign[event.designId];
          if (run?.generationId !== event.generationId) return {};
          return {
            generationByDesign: {
              ...state.generationByDesign,
              [event.designId]: { ...run, streamedAssistantText: trimmed },
            },
          };
        });
        if (!event.chatPersisted) {
          void appendChatMessage({
            designId: current.designId,
            kind: 'assistant_text',
            payload: { text: finalText },
          });
        }
        current.lastPersistedText = finalText;
      }
      if (event.chatPersisted && useCodesignStore.getState().currentDesignId === event.designId) {
        void useCodesignStore.getState().loadChatForCurrentDesign();
      }
      if (current) drainPendingTools(current, 'done');
      setStreamingAssistantText({ designId: event.designId, text: '' });
      if (current) current.textBuffer = '';
    };

    const handleToolCallStart = (event: AgentStreamEvent, replay = false) => {
      const current = inFlight.current.get(event.generationId);
      const designId = event.designId;
      const toolName = event.toolName ?? 'unknown';
      const initialStatus =
        event.status === 'done' || event.status === 'error' ? event.status : 'running';
      if (initialStatus === 'running') {
        markGenerationRunning(event.designId, event.generationId, 'streaming');
      }
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] tool_call_start', {
        generationId: event.generationId,
        designId,
        toolName,
        toolCallId: event.toolCallId,
        status: initialStatus,
      });
      // set_title updates design metadata only. Moving the workspace folder
      // here can race with file reads/writes from the active generation.
      if (toolName === 'set_title' && !replay) {
        const rawTitle = (event.args as { title?: unknown } | undefined)?.title;
        if (typeof rawTitle === 'string' && rawTitle.trim().length > 0) {
          const cleaned = rawTitle
            .trim()
            .replace(/[\s.,;:!?—–-]+$/u, '')
            .slice(0, 60);
          if (cleaned.length > 0) {
            void renameDesign(designId, cleaned, { renameWorkspace: false });
          }
        }
      }
      // DB row rather than an in-memory shadow. Capture seq via promise so
      // the result handler can patch the same row even if it lands before
      // the append round-trip completes.
      if (event.chatPersisted) return;
      const seqPromise = appendChatMessage({
        designId,
        kind: 'tool_call',
        payload: {
          toolName,
          ...(event.command !== undefined ? { command: event.command } : {}),
          args: event.args ?? {},
          status: initialStatus,
          startedAt: new Date().toISOString(),
          verbGroup: event.verbGroup ?? 'Working',
          ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
          ...(event.result !== undefined ? { result: event.result } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(initialStatus === 'error' && typeof event.message === 'string'
            ? { error: { message: event.message } }
            : {}),
        },
      }).then((row) => row?.seq ?? null);
      if (current && initialStatus === 'running') {
        current.pendingTools.push({
          seqPromise,
          toolName,
          toolCallId: event.toolCallId,
          resolved: false,
        });
      }
    };

    const handleToolCallResult = (event: AgentStreamEvent) => {
      markGenerationRunning(event.designId, event.generationId, 'streaming');
      if (event.chatPersisted) return;
      const current = inFlight.current.get(event.generationId);
      const designId = event.designId;
      if (!current) return;
      const idx = current.pendingTools.findIndex(
        (p) =>
          !p.resolved &&
          (event.toolCallId !== undefined && p.toolCallId !== undefined
            ? p.toolCallId === event.toolCallId
            : p.toolName === (event.toolName ?? 'unknown')),
      );
      if (idx < 0) return;
      const pending = current.pendingTools[idx];
      if (!pending) return;
      pending.resolved = true;
      const result = event.result;
      const durationMs = event.durationMs;
      const finalStatus = event.status === 'error' ? 'error' : 'done';
      void pending.seqPromise.then((seq) => {
        if (seq === null) return;
        void updateChatToolStatus({
          designId,
          seq,
          status: finalStatus,
          ...(result !== undefined ? { result } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(finalStatus === 'error' && typeof event.message === 'string'
            ? { errorMessage: event.message }
            : {}),
        });
      });
    };

    const handleFsUpdated = (event: AgentStreamEvent) => {
      markGenerationRunning(event.designId, event.generationId, 'streaming');
      // Live mirror of the agent edit tool's mutations into the iframe.
      // App.jsx is the default source file. Legacy workspaces may still use
      // index.html directly or as a small placeholder pointing at JSX/TSX.
      if (typeof event.path !== 'string' || typeof event.content !== 'string') return;
      if (event.path === DEFAULT_SOURCE_ENTRY || event.path === LEGACY_SOURCE_ENTRY) {
        scheduleFs({
          designId: event.designId,
          generationId: event.generationId,
          path: event.path,
          content: event.content,
        });
        return;
      }
      const state = useCodesignStore.getState();
      const visible = state.currentDesignId === event.designId;
      const currentSource = visible
        ? state.previewSource
        : state.previewSourceByDesign[event.designId];
      if (!currentSource) return;
      const referencedPath = resolveReferencedWorkspacePreviewPath(
        currentSource,
        LEGACY_SOURCE_ENTRY,
      );
      if (referencedPath === event.path) {
        scheduleFs({
          designId: event.designId,
          generationId: event.generationId,
          path: event.path,
          content: event.content,
        });
      }
    };

    const handleError = (event: AgentStreamEvent) => {
      const current = inFlight.current.get(event.generationId);
      // TODO: replace with rendererLogger once renderer-logger lands
      console.error('[agent] error', {
        generationId: event.generationId,
        designId: event.designId,
        message: event.message,
        code: event.code,
      });
      if (current) drainPendingTools(current, 'error');
      setStreamingAssistantText({ designId: event.designId, text: '' });
      inFlight.current.delete(event.generationId);
      const s = useCodesignStore.getState();
      const currentRun = s.generationByDesign[event.designId];
      // The IPC rejection owns local-run diagnostics; consuming its identity
      // here would make the subsequent error look like a stale response.
      if (currentRun?.generationId === event.generationId && currentRun.awaitingResponse) return;
      if (!event.chatPersisted)
        void appendChatMessage({
          designId: event.designId,
          kind: 'error',
          payload: {
            message: event.message ?? 'Unknown error',
            ...(event.code ? { code: event.code } : {}),
          },
        });
      // Defensive: clear generation flags so the UI never gets stuck showing
      // "running" if the IPC promise that drives sendPrompt hangs. Only clear
      // when the error belongs to the design the store thinks is generating.
      if (currentRun?.generationId === event.generationId) {
        const generationByDesign = { ...s.generationByDesign };
        delete generationByDesign[event.designId];
        const activeForCurrent =
          s.currentDesignId === null ? undefined : generationByDesign[s.currentDesignId];
        useCodesignStore.setState({
          generationByDesign,
          isGenerating: activeForCurrent !== undefined,
          activeGenerationId: activeForCurrent?.generationId ?? null,
          generatingDesignId: activeForCurrent !== undefined ? s.currentDesignId : null,
          generationStage:
            activeForCurrent?.stage ??
            (s.currentDesignId === event.designId ? 'error' : s.generationStage),
        });
      }
    };

    const handleAgentEnd = (event: AgentStreamEvent) => {
      if (event.seq !== undefined) {
        fsScheduler.flushGeneration(event.generationId);
        setStreamingAssistantText({ designId: event.designId, text: '' });
        return;
      }
      // Flush only this generation's pending preview updates before persisting
      // the final snapshot so concurrent background runs stay isolated.
      fsScheduler.flushGeneration(event.generationId);
      const current = inFlight.current.get(event.generationId);
      const finalText = current?.lastPersistedText ?? undefined;
      void persistAgentRunSnapshot({
        designId: event.designId,
        ...(finalText ? { finalText } : {}),
      });
      inFlight.current.delete(event.generationId);
      setStreamingAssistantText({ designId: event.designId, text: '' });
      // Rehydrated runs have no local IPC promise. Locally submitted runs must
      // retain their identity until the response delivers usage, artifacts or
      // an error: pi emits agent_end before either success or rejection.
      const s = useCodesignStore.getState();
      const currentRun = s.generationByDesign[event.designId];
      if (currentRun?.generationId === event.generationId && !currentRun.awaitingResponse) {
        const generationByDesign = { ...s.generationByDesign };
        delete generationByDesign[event.designId];
        const activeForCurrent =
          s.currentDesignId === null ? undefined : generationByDesign[s.currentDesignId];
        useCodesignStore.setState({
          generationByDesign,
          isGenerating: activeForCurrent !== undefined,
          activeGenerationId: activeForCurrent?.generationId ?? null,
          generatingDesignId: activeForCurrent !== undefined ? s.currentDesignId : null,
          generationStage:
            activeForCurrent?.stage ??
            (s.currentDesignId === event.designId ? 'done' : s.generationStage),
        });
      }
      if (currentRun?.awaitingResponse) return;
      // Fire the auto-polish follow-up exactly once per design. Delay so the
      // isGenerating flag and persisted assistant_text row have settled before
      // sendPrompt inspects them. The guard inside tryAutoPolish dedupes.
      const designId = event.designId;
      setTimeout(() => {
        // Locale is read from the i18n module the renderer already initialised.
        // Fall back to 'en' if i18next isn't ready yet (shouldn't happen in
        // practice — agent_end implies the UI has been running for a while).
        let locale = 'en';
        try {
          const i18n = (globalThis as { i18next?: { language?: string } }).i18next;
          if (i18n?.language) locale = i18n.language;
        } catch {
          /* noop */
        }
        useCodesignStore.getState().tryAutoPolish(designId, locale);
      }, 1200);
    };

    const ignoreIfCancelled = (event: AgentStreamEvent): boolean => {
      if (!useCodesignStore.getState().cancelledGenerationIds.has(event.generationId)) {
        return false;
      }
      fsScheduler.clearGeneration(event.generationId);
      inFlight.current.delete(event.generationId);
      setStreamingAssistantText({ designId: event.designId, text: '' });
      if (event.seq === undefined && (event.type === 'agent_end' || event.type === 'error')) {
        forgetCancelledGeneration(event.generationId);
      }
      return true;
    };

    let chatRefresh: ReturnType<typeof setTimeout> | undefined;
    const refreshChat = (designId: string) => {
      if (useCodesignStore.getState().currentDesignId !== designId) return;
      if (chatRefresh !== undefined) clearTimeout(chatRefresh);
      chatRefresh = setTimeout(() => {
        chatRefresh = undefined;
        if (useCodesignStore.getState().currentDesignId === designId)
          void useCodesignStore.getState().loadChatForCurrentDesign();
      }, 50);
    };
    const handleSettled = (event: AgentStreamEvent, replay: boolean) => {
      useCodesignStore.setState((state) => ({
        settledGenerationIds: new Set([...state.settledGenerationIds, event.generationId]),
      }));
      const owner = useCodesignStore.getState().generationByDesign[event.designId];
      if (owner && owner.generationId !== event.generationId) {
        fsScheduler.clearGeneration(event.generationId);
        inFlight.current.delete(event.generationId);
        return;
      }
      fsScheduler.flushGeneration(event.generationId);
      inFlight.current.delete(event.generationId);
      setStreamingAssistantText({ designId: event.designId, text: '' });
      refreshChat(event.designId);
      const state = useCodesignStore.getState();
      const run = state.generationByDesign[event.designId];
      if (run?.generationId !== event.generationId || run.awaitingResponse) return;
      const generationByDesign = { ...state.generationByDesign };
      delete generationByDesign[event.designId];
      const visible = state.currentDesignId === event.designId;
      const active = state.currentDesignId ? generationByDesign[state.currentDesignId] : undefined;
      useCodesignStore.setState({
        generationByDesign,
        isGenerating: active !== undefined,
        activeGenerationId: active?.generationId ?? null,
        generatingDesignId: active ? state.currentDesignId : null,
        generationStage:
          active?.stage ??
          (visible
            ? event.outcome === 'completed'
              ? 'done'
              : event.outcome === 'cancelled'
                ? 'idle'
                : 'error'
            : state.generationStage),
        ...(event.response ? { lastUsage: coerceUsageSnapshot(event.response).usage } : {}),
        ...(visible && event.message && event.outcome !== 'cancelled'
          ? { errorMessage: event.message, lastError: event.message }
          : {}),
      });
      if (event.outcome === 'completed' && event.response?.snapshotId) {
        void useCodesignStore.getState().loadDesigns();
        void window.codesign?.snapshots
          .list(event.designId)
          .then((snapshots) => {
            const current = useCodesignStore.getState();
            if (
              current.currentDesignId === event.designId &&
              !current.generationByDesign[event.designId]
            ) {
              useCodesignStore.setState({ currentSnapshotId: snapshots[0]?.id ?? null });
            }
          })
          .catch((error: unknown) =>
            console.warn('[open-codesign] snapshot refresh failed:', error),
          );
      }
      if (!replay && event.response?.artifacts[0]?.content)
        setPreviewSourceFromAgent({
          designId: event.designId,
          content: event.response.artifacts[0].content,
        });
    };
    const consume = (event: AgentStreamEvent, replay = false) => {
      if (event.chatPersisted) {
        if (
          ['turn_end', 'tool_call_start', 'tool_call_result', 'run_settled', 'error'].includes(
            event.type,
          )
        )
          refreshChat(event.designId);
        useCodesignStore.setState((state) => {
          const run = state.generationByDesign[event.designId];
          if (run?.generationId !== event.generationId) return {};
          return {
            generationByDesign: {
              ...state.generationByDesign,
              [event.designId]: { ...run, chatPersisted: true },
            },
          };
        });
      }
      if (event.type === 'run_settled') {
        handleSettled(event, replay);
        forgetCancelledGeneration(event.generationId);
        return;
      }
      if (
        event.seq !== undefined &&
        useCodesignStore.getState().settledGenerationIds.has(event.generationId)
      )
        return;
      const active = useCodesignStore.getState().generationByDesign[event.designId];
      if (event.seq !== undefined && active && active.generationId !== event.generationId) return;
      // Delivery bookkeeping must survive Stop's late-generation event filter.
      if (event.type === 'active_message') {
        const message = event.activeMessage;
        if (
          message &&
          message.designId === event.designId &&
          message.generationId === event.generationId
        ) {
          useCodesignStore.getState().reconcileActiveMessage(message);
        }
        return;
      }
      if (ignoreIfCancelled(event)) return;
      switch (event.type) {
        case 'turn_start':
          handleTurnStart(event);
          return;
        case 'text_delta':
          handleTextDelta(event);
          return;
        case 'turn_end':
          handleTurnEnd(event);
          return;
        case 'tool_call_start':
          handleToolCallStart(event, replay);
          return;
        case 'tool_call_result':
          handleToolCallResult(event);
          return;
        case 'fs_updated':
          if (!replay) handleFsUpdated(event);
          return;
        case 'agent_end':
          handleAgentEnd(event);
          return;
        case 'error':
          handleError(event);
          return;
      }
    };
    const api = window.codesign;
    const attachment =
      typeof api.recoverRuns === 'function'
        ? attachRunEvents({
            subscribe: (listener) => api.chat.onAgentEvent(listener),
            recover: async (cursors) => {
              const recovered = await api.recoverRuns(cursors);
              // Repair may only return already-consumed cursors; refresh the repaired chat too.
              const designId = useCodesignStore.getState().currentDesignId;
              if (designId) refreshChat(designId);
              return recovered;
            },
            consume,
            onError: (error) => console.warn('[open-codesign] run recovery failed:', error),
          })
        : null;
    const off = attachment ? () => attachment.dispose() : api.chat.onAgentEvent(consume);
    const recover = () => {
      void attachment?.recover();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover();
    };
    window.addEventListener?.('focus', recover);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', onVisibility);
    return () => {
      off();
      window.removeEventListener?.('focus', recover);
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisibility);
      if (chatRefresh !== undefined) clearTimeout(chatRefresh);
      fsScheduler.clearAll();
    };
  }, [
    appendChatMessage,
    setStreamingAssistantText,
    setPreviewSourceFromAgent,
    updateChatToolStatus,
    persistAgentRunSnapshot,
    renameDesign,
    markGenerationRunning,
    forgetCancelledGeneration,
  ]);
}
