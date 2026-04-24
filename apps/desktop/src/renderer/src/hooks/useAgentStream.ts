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

import { useEffect, useRef } from 'react';
import type { AgentStreamEvent } from '../../../preload/index';
import { useCodesignStore } from '../store';

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
  const setPreviewHtmlFromAgent = useCodesignStore((s) => s.setPreviewHtmlFromAgent);
  const updateChatToolStatus = useCodesignStore((s) => s.updateChatToolStatus);
  const persistAgentRunSnapshot = useCodesignStore((s) => s.persistAgentRunSnapshot);
  const renameDesign = useCodesignStore((s) => s.renameDesign);
  const inFlight = useRef<InFlightTurn | null>(null);

  // Throttled live-preview push. iframe srcdoc reloads the whole page on every
  // change, so a flurry of str_replace events (10+ per turn is normal) would
  // strobe. Coalesce to ~250ms with a guaranteed trailing edge so the final
  // state always lands.
  const fsThrottle = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: { designId: string; content: string } | null;
    lastFlushAt: number;
  }>({ timer: null, pending: null, lastFlushAt: 0 });
  const FS_THROTTLE_MS = 250;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.codesign) return;
    const flushFs = () => {
      const slot = fsThrottle.current;
      slot.timer = null;
      const pending = slot.pending;
      slot.pending = null;
      if (!pending) return;
      slot.lastFlushAt = Date.now();
      setPreviewHtmlFromAgent(pending);
    };
    const scheduleFs = (next: { designId: string; content: string }) => {
      const slot = fsThrottle.current;
      slot.pending = next;
      const since = Date.now() - slot.lastFlushAt;
      if (since >= FS_THROTTLE_MS && slot.timer === null) {
        // Cold path: flush immediately, then a future event will land within
        // the throttle window and be coalesced.
        flushFs();
        return;
      }
      if (slot.timer !== null) return;
      slot.timer = setTimeout(flushFs, Math.max(FS_THROTTLE_MS - since, 0));
    };

    const handleTurnStart = (event: AgentStreamEvent) => {
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_start', {
        generationId: event.generationId,
        designId: event.designId,
      });
      const previous = inFlight.current;
      const sameRun =
        previous &&
        previous.designId === event.designId &&
        previous.generationId === event.generationId;
      inFlight.current = {
        designId: event.designId,
        generationId: event.generationId,
        textBuffer: '',
        lastPersistedText: sameRun ? previous.lastPersistedText : null,
        pendingTools: sameRun ? previous.pendingTools : [],
      };
      setStreamingAssistantText({ designId: event.designId, text: '' });
    };

    const handleTextDelta = (event: AgentStreamEvent) => {
      if (!inFlight.current || typeof event.delta !== 'string') return;
      inFlight.current.textBuffer += event.delta;
      setStreamingAssistantText({
        designId: inFlight.current.designId,
        text: inFlight.current.textBuffer,
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
      const current = inFlight.current;
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] turn_end', {
        generationId: event.generationId,
        designId: event.designId,
        textLen: (event.finalText ?? current?.textBuffer ?? '').length,
      });
      const finalText = event.finalText ?? current?.textBuffer ?? '';
      const trimmed = finalText.trim();
      if (current && trimmed.length > 0 && trimmed !== current.lastPersistedText?.trim()) {
        void appendChatMessage({
          designId: current.designId,
          kind: 'assistant_text',
          payload: { text: finalText },
        });
        current.lastPersistedText = finalText;
      }
      if (current) drainPendingTools(current, 'done');
      setStreamingAssistantText(null);
      if (current) current.textBuffer = '';
    };

    const handleToolCallStart = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      const designId = event.designId;
      const toolName = event.toolName ?? 'unknown';
      // TODO: replace with rendererLogger once renderer-logger lands
      console.debug('[agent] tool_call_start', {
        generationId: event.generationId,
        designId,
        toolName,
        toolCallId: event.toolCallId,
      });
      // set_title runs with no side effects on disk — its whole job is
      // to rename the design. Trigger the rename immediately off the
      // start event so the sidebar label flips without waiting for the
      // result round-trip.
      if (toolName === 'set_title') {
        const rawTitle = (event.args as { title?: unknown } | undefined)?.title;
        if (typeof rawTitle === 'string' && rawTitle.trim().length > 0) {
          const cleaned = rawTitle
            .trim()
            .replace(/[\s.,;:!?—–\-]+$/u, '')
            .slice(0, 60);
          if (cleaned.length > 0) {
            void renameDesign(designId, cleaned);
          }
        }
      }
      // DB row rather than an in-memory shadow. Capture seq via promise so
      // the result handler can patch the same row even if it lands before
      // the append round-trip completes.
      const seqPromise = appendChatMessage({
        designId,
        kind: 'tool_call',
        payload: {
          toolName,
          ...(event.command !== undefined ? { command: event.command } : {}),
          args: event.args ?? {},
          status: 'running',
          startedAt: new Date().toISOString(),
          verbGroup: event.verbGroup ?? 'Working',
          ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
        },
      }).then((row) => row?.seq ?? null);
      if (current) {
        current.pendingTools.push({
          seqPromise,
          toolName,
          toolCallId: event.toolCallId,
          resolved: false,
        });
      }
    };

    const handleToolCallResult = (event: AgentStreamEvent) => {
      const current = inFlight.current;
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
      void pending.seqPromise.then((seq) => {
        if (seq === null) return;
        void updateChatToolStatus({
          designId,
          seq,
          status: 'done',
          ...(result !== undefined ? { result } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      });
    };

    const handleFsUpdated = (event: AgentStreamEvent) => {
      // Live mirror of the agent's text_editor mutations into the iframe.
      // We only react to index.html — other paths (frames/, skills/) are
      // read-only context and never become the rendered artifact.
      if (event.path === 'index.html' && typeof event.content === 'string') {
        scheduleFs({ designId: event.designId, content: event.content });
      }
    };

    const handleError = (event: AgentStreamEvent) => {
      const current = inFlight.current;
      // TODO: replace with rendererLogger once renderer-logger lands
      console.error('[agent] error', {
        generationId: event.generationId,
        designId: event.designId,
        message: event.message,
        code: event.code,
      });
      setStreamingAssistantText(null);
      inFlight.current = null;
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
      const s = useCodesignStore.getState();
      if (s.generatingDesignId === event.designId) {
        useCodesignStore.setState({
          isGenerating: false,
          generatingDesignId: null,
          generationStage: 'error',
          streamingAssistantText: null,
        });
      }
    };

    const handleAgentEnd = (event: AgentStreamEvent) => {
      // Flush any throttled fs_updated payload synchronously so the preview
      // store reflects the final html before we read it back for persistence.
      const slot = fsThrottle.current;
      if (slot.timer !== null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      const pending = slot.pending;
      slot.pending = null;
      if (pending) {
        slot.lastFlushAt = Date.now();
        setPreviewHtmlFromAgent(pending);
      }
      const finalText = inFlight.current?.lastPersistedText ?? undefined;
      void persistAgentRunSnapshot({
        designId: event.designId,
        ...(finalText ? { finalText } : {}),
      });
      inFlight.current = null;
      // Defensive: clear generation flags. The sendPrompt Promise resolution
      // would normally clear them shortly after, but if the main-process IPC
      // hangs for any reason the UI would be stuck in "running" forever.
      // Mirror the happy-path terminal state here as a belt-and-suspenders.
      const s = useCodesignStore.getState();
      if (s.generatingDesignId === event.designId) {
        useCodesignStore.setState({
          isGenerating: false,
          generatingDesignId: null,
          generationStage: 'done',
          streamingAssistantText: null,
        });
      }
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

    const off = window.codesign.chat.onAgentEvent((event: AgentStreamEvent) => {
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
          handleToolCallStart(event);
          return;
        case 'tool_call_result':
          handleToolCallResult(event);
          return;
        case 'fs_updated':
          handleFsUpdated(event);
          return;
        case 'agent_end':
          handleAgentEnd(event);
          return;
        case 'error':
          handleError(event);
          return;
      }
    });
    return () => {
      off();
      const slot = fsThrottle.current;
      if (slot.timer !== null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      slot.pending = null;
    };
  }, [
    appendChatMessage,
    setStreamingAssistantText,
    setPreviewHtmlFromAgent,
    updateChatToolStatus,
    persistAgentRunSnapshot,
  ]);
}
