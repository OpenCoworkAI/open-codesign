import type { ActiveRunMessageV1 } from '@open-codesign/shared';
import type { CodesignState } from '../../store';
import { newId, normalizeReferenceUrl, tr } from '../lib/locale';

type SetState = (
  updater: Partial<CodesignState> | ((state: CodesignState) => Partial<CodesignState>),
) => void;
type Actions = Pick<
  CodesignState,
  | 'setComposerDraft'
  | 'sendActiveMessage'
  | 'syncActiveMessages'
  | 'reconcileActiveMessage'
  | 'recoverActiveMessage'
>;

function mergeMessage(
  rows: ActiveRunMessageV1[],
  message: ActiveRunMessageV1,
): ActiveRunMessageV1[] {
  const previous = rows.find((row) => row.messageId === message.messageId);
  if (previous) {
    if (previous.generationId !== message.generationId) return rows;
    // An acceptance/list response may arrive after the delivery event.
    if (previous.status !== 'pending' && message.status === 'pending') return rows;
    if (previous.status === 'delivered') return rows;
    return rows.map((row) => (row.messageId === message.messageId ? message : row));
  }
  return [...rows, message];
}

export function makeActiveMessagesSlice(set: SetState, get: () => CodesignState): Actions {
  const accepting = new Map<string, { designId: string; generationId: string }>();
  const reportError = (error: unknown, title: string) => {
    get().pushToast({
      variant: 'error',
      title: tr(title),
      description: error instanceof Error ? error.message : tr('errors.unknown'),
    });
  };
  return {
    setComposerDraft(text, designId = get().currentDesignId) {
      set((state) => ({
        composerDrafts: { ...state.composerDrafts, [designId ?? '']: text },
      }));
    },

    async sendActiveMessage(text, mode) {
      const state = get();
      const designId = state.currentDesignId;
      const run = designId ? state.generationByDesign[designId] : undefined;
      if (designId && state.activeMessageSendingByDesign[designId]) return;
      const messageId = newId();
      try {
        const referenceUrl = normalizeReferenceUrl(state.referenceUrl);
        if (
          state.inputFiles.length ||
          (referenceUrl && referenceUrl !== run?.submittedContext?.referenceUrl) ||
          state.queuedCommentIds.some((id) => !run?.submittedContext?.commentIds.includes(id))
        ) {
          throw new Error(tr('activeMessages.textOnlyError'));
        }
        if (!designId || !run || state.cancelledGenerationIds.has(run.generationId)) {
          throw new Error(tr('activeMessages.notRunning'));
        }
        if (!window.codesign?.sendActiveMessage) {
          throw new Error(tr('errors.rendererDisconnected'));
        }
        if (!text.trim()) return;
        set((current) => ({
          activeMessageSendingByDesign: {
            ...current.activeMessageSendingByDesign,
            [designId]: true,
          },
        }));
        accepting.set(messageId, { designId, generationId: run.generationId });
        const message = await window.codesign.sendActiveMessage({
          schemaVersion: 1,
          designId,
          generationId: run.generationId,
          messageId,
          mode,
          text: text.trim(),
        });
        const messages = mergeMessage(get().activeMessagesByDesign[designId] ?? [], message);
        const outcome = messages.find((row) => row.messageId === message.messageId) ?? message;
        set((current) => ({
          activeMessagesByDesign: {
            ...current.activeMessagesByDesign,
            [designId]: messages,
          },
          composerDrafts:
            outcome.status !== 'not-delivered' && current.composerDrafts[designId] === text
              ? { ...current.composerDrafts, [designId]: '' }
              : current.composerDrafts,
        }));
        if (outcome.status === 'not-delivered') {
          throw new Error(outcome.reason ?? tr('activeMessages.notDelivered'));
        }
        if (message.status === 'delivered' && get().currentDesignId === designId) {
          await get().loadChatForCurrentDesign();
        }
      } catch (error) {
        reportError(error, 'activeMessages.sendFailed');
        throw error;
      } finally {
        accepting.delete(messageId);
        if (designId) {
          set((current) => ({
            activeMessageSendingByDesign: {
              ...current.activeMessageSendingByDesign,
              [designId]: false,
            },
          }));
        }
      }
    },

    async syncActiveMessages(designId = get().currentDesignId ?? undefined) {
      if (!designId || !window.codesign?.listActiveMessages) return;
      try {
        const rows = await window.codesign.listActiveMessages(designId);
        const previous = get().activeMessagesByDesign[designId] ?? [];
        set((state) => ({
          activeMessagesByDesign: {
            ...state.activeMessagesByDesign,
            [designId]: rows
              .filter((row) => row.designId === designId)
              .reduce(
                (current, row) => mergeMessage(current, row),
                state.activeMessagesByDesign[designId] ?? [],
              ),
          },
        }));
        if (
          get().currentDesignId === designId &&
          rows.some(
            (row) =>
              row.status === 'delivered' &&
              !previous.some(
                (old) => old.messageId === row.messageId && old.status === 'delivered',
              ),
          )
        ) {
          await get().loadChatForCurrentDesign();
        }
      } catch (error) {
        reportError(error, 'activeMessages.loadFailed');
      }
    },

    reconcileActiveMessage(message) {
      const state = get();
      const rows = state.activeMessagesByDesign[message.designId] ?? [];
      const known = rows.some(
        (row) => row.messageId === message.messageId && row.generationId === message.generationId,
      );
      const submitted = accepting.get(message.messageId);
      const isAccepting =
        submitted?.designId === message.designId && submitted.generationId === message.generationId;
      if (
        !known &&
        !isAccepting &&
        state.generationByDesign[message.designId]?.generationId !== message.generationId
      )
        return;
      set({
        activeMessagesByDesign: {
          ...state.activeMessagesByDesign,
          [message.designId]: mergeMessage(rows, message),
        },
      });
      if (message.status === 'delivered' && get().currentDesignId === message.designId) {
        void get().loadChatForCurrentDesign();
      }
    },

    recoverActiveMessage(designId, messageId) {
      const state = get();
      const message = state.activeMessagesByDesign[designId]?.find(
        (row) => row.messageId === messageId && row.status !== 'delivered',
      );
      if (!message) return;
      const draft = state.composerDrafts[designId] ?? '';
      get().setComposerDraft(draft ? `${draft}\n\n${message.text}` : message.text, designId);
    },
  };
}
