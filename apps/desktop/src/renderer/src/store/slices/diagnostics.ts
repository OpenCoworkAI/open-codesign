import type { ReportableError } from '@open-codesign/shared';
import { computeFingerprint } from '@open-codesign/shared/fingerprint';
import { snapshotTimeline } from '../../lib/action-timeline.js';
import type { CodesignState } from '../../store.js';
import { newId } from '../lib/locale.js';
import { MAX_REPORTABLE, type Toast } from './errors.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

interface DiagnosticsSliceActions {
  pushToast: CodesignState['pushToast'];
  dismissToast: CodesignState['dismissToast'];
  reportableErrorToast: CodesignState['reportableErrorToast'];
  refreshDiagnosticEvents: CodesignState['refreshDiagnosticEvents'];
  markDiagnosticsRead: CodesignState['markDiagnosticsRead'];
  reportDiagnosticEvent: CodesignState['reportDiagnosticEvent'];
  createReportableError: CodesignState['createReportableError'];
  getReportableError: CodesignState['getReportableError'];
  openReportDialog: CodesignState['openReportDialog'];
  closeReportDialog: CodesignState['closeReportDialog'];
}

export function makeDiagnosticsSlice(set: SetState, get: GetState): DiagnosticsSliceActions {
  return {
    pushToast(toast) {
      const id = newId();
      // Every error toast without an explicit `localId` gets one here: the
      // Report button must always have a live ReportableError to open,
      // regardless of which error path produced the toast. Callers that want
      // richer context (stack, runId, structured context) should construct
      // the ReportableError explicitly via `createReportableError` first.
      let localId = toast.localId;
      if (toast.variant === 'error' && localId === undefined) {
        localId = get().createReportableError({
          code: 'RENDERER_ERROR',
          scope: 'renderer',
          message: toast.description ?? toast.title,
        });
      }
      const next: Toast = { id, ...toast, ...(localId ? { localId } : {}) };
      set((s) => {
        let toasts = s.toasts;
        // Error toasts are sticky (AUTO_DISMISS_MS.error is null) so they can
        // pile up and cover the preview during a retry storm. Keep them sticky
        // but cap visible errors at 3 by dropping the oldest on overflow.
        if (toast.variant === 'error') {
          const errors = toasts.filter((t) => t.variant === 'error');
          if (errors.length >= 3) {
            const oldestId = errors[0]?.id;
            if (oldestId !== undefined) {
              toasts = toasts.filter((t) => t.id !== oldestId);
            }
          }
        }
        return { toasts: [...toasts, next] };
      });
      return id;
    },

    dismissToast(id?: string) {
      if (id === undefined) {
        set({ toastMessage: null });
        return;
      }
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
    reportableErrorToast(spec) {
      if (spec.reportable === false) {
        return get().pushToast({
          variant: 'error',
          title: spec.title,
          ...(spec.description !== undefined ? { description: spec.description } : {}),
          ...(spec.action !== undefined ? { action: spec.action } : {}),
        });
      }
      const localId = get().createReportableError({
        code: spec.code,
        scope: spec.scope,
        message: spec.description ?? spec.title,
        ...(spec.stack !== undefined ? { stack: spec.stack } : {}),
        ...(spec.runId !== undefined ? { runId: spec.runId } : {}),
        ...(spec.context !== undefined ? { context: spec.context } : {}),
      });
      return get().pushToast({
        variant: 'error',
        title: spec.title,
        ...(spec.description !== undefined ? { description: spec.description } : {}),
        ...(spec.action !== undefined ? { action: spec.action } : {}),
        localId,
      });
    },

    async refreshDiagnosticEvents() {
      const api = window.codesign?.diagnostics;
      if (!api?.listEvents) return;
      // Hydrate the persisted lastReadTs once per session so the unread badge
      // survives a restart instead of counting every historical error as new.
      if (!get().diagnosticsPrefsHydrated) {
        try {
          const prefs = await window.codesign?.preferences?.get?.();
          const persisted = prefs?.diagnosticsLastReadTs;
          if (typeof persisted === 'number' && persisted > 0) {
            set({ lastReadTs: persisted });
          }
        } catch {
          // Non-fatal: fall back to default 0.
        }
        set({ diagnosticsPrefsHydrated: true });
      }
      const result = await api.listEvents({
        schemaVersion: 1,
        limit: 100,
        includeTransient: false,
      });
      const events = result.events;
      const { lastReadTs } = get();
      const unreadErrorCount = events.filter(
        (e) => e.level === 'error' && e.ts > lastReadTs,
      ).length;
      set({ recentEvents: events, unreadErrorCount });
    },

    markDiagnosticsRead() {
      const now = Date.now();
      set({ unreadErrorCount: 0, lastReadTs: now });
      void window.codesign?.preferences?.update?.({ diagnosticsLastReadTs: now })?.catch(() => {
        // Non-fatal: if persistence fails the in-memory value still works for
        // this session.
      });
    },

    async reportDiagnosticEvent(input) {
      const api = window.codesign?.diagnostics;
      if (!api?.reportEvent) {
        throw new Error('diagnostics.reportEvent unavailable');
      }
      return api.reportEvent({
        schemaVersion: 1,
        error: input.error,
        includePromptText: input.includePromptText,
        includePaths: input.includePaths,
        includeUrls: input.includeUrls,
        includeTimeline: input.includeTimeline,
        notes: input.notes,
        timeline: snapshotTimeline(),
      });
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
    createReportableError(partial) {
      const localId = newId();
      const ts = Date.now();
      const fingerprint = computeFingerprint({
        errorCode: partial.code,
        stack: partial.stack,
        message: partial.message,
      });
      const record: ReportableError = {
        localId,
        code: partial.code,
        scope: partial.scope,
        message: partial.message,
        fingerprint,
        ts,
      };
      if (partial.stack !== undefined) record.stack = partial.stack;
      if (partial.runId !== undefined) record.runId = partial.runId;
      if (partial.context !== undefined) record.context = partial.context;

      set((s) => {
        const next = [...s.reportableErrors, record];
        if (next.length > MAX_REPORTABLE) next.splice(0, next.length - MAX_REPORTABLE);
        return { reportableErrors: next };
      });

      // Fire-and-forget DB persistence. Report UX does not depend on this.
      const api =
        typeof window !== 'undefined'
          ? window.codesign?.diagnostics?.recordRendererError
          : undefined;
      if (api) {
        const payload: {
          schemaVersion: 1;
          code: string;
          scope: string;
          message: string;
          stack?: string;
          runId?: string;
          context?: Record<string, unknown>;
        } = {
          schemaVersion: 1,
          code: partial.code,
          scope: partial.scope,
          message: partial.message,
        };
        if (partial.stack !== undefined) payload.stack = partial.stack;
        if (partial.runId !== undefined) payload.runId = partial.runId;
        if (partial.context !== undefined) payload.context = partial.context;
        void api(payload)
          .then((res) => {
            if (res.eventId === null) return;
            const eventId = res.eventId;
            // Batch A echoes `fingerprint` alongside eventId so the renderer
            // stops trusting its own FNV estimate once the DB row has been
            // written. Guarded on type for the transition window while Batch A's
            // type extension is landing.
            const echoed = (res as { fingerprint?: unknown }).fingerprint;
            const persistedFingerprint = typeof echoed === 'string' ? echoed : undefined;
            set((s) => ({
              reportableErrors: s.reportableErrors.map((existing) =>
                existing.localId === localId
                  ? {
                      ...existing,
                      persistedEventId: eventId,
                      ...(persistedFingerprint !== undefined ? { persistedFingerprint } : {}),
                    }
                  : existing,
              ),
            }));
          })
          .catch(() => {
            // DB persistence is nice-to-have; Report still works without it.
          });
      }
      return localId;
    },

    getReportableError(localId) {
      return get().reportableErrors.find((r) => r.localId === localId);
    },

    openReportDialog(localId) {
      set({ activeReportLocalId: localId });
    },
    closeReportDialog() {
      set({ activeReportLocalId: null });
    },
  };
}
