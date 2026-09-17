import type { CodesignState } from '../../store.js';
import { tr } from '../lib/locale.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

interface CommentsSliceActions {
  loadCommentsForCurrentDesign: CodesignState['loadCommentsForCurrentDesign'];
  openCommentBubble: CodesignState['openCommentBubble'];
  closeCommentBubble: CodesignState['closeCommentBubble'];
  queueCommentForPrompt: CodesignState['queueCommentForPrompt'];
  unqueueCommentForPrompt: CodesignState['unqueueCommentForPrompt'];
  applyLiveRects: CodesignState['applyLiveRects'];
  clearLiveRects: CodesignState['clearLiveRects'];
  addComment: CodesignState['addComment'];
  updateComment: CodesignState['updateComment'];
  submitComment: CodesignState['submitComment'];
  removeComment: CodesignState['removeComment'];
}

export function makeCommentsSlice(set: SetState, get: GetState): CommentsSliceActions {
  return {
    async loadCommentsForCurrentDesign() {
      if (!window.codesign) return;
      const designId = get().currentDesignId;
      if (!designId) {
        set({ comments: [], commentsLoaded: true, currentSnapshotId: null });
        return;
      }
      try {
        const [rows, snaps] = await Promise.all([
          window.codesign.comments.list(designId),
          window.codesign.snapshots.list(designId),
        ]);
        if (get().currentDesignId !== designId) return;
        set({
          comments: rows,
          commentsLoaded: true,
          currentSnapshotId: snaps[0]?.id ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        console.warn('[open-codesign] loadCommentsForCurrentDesign failed:', msg);
        set({ commentsLoaded: true });
      }
    },

    openCommentBubble(anchor) {
      if (anchor.existingCommentId && anchor.sourcePath) {
        get().openCanvasFileTab(anchor.sourcePath);
      }
      set({ commentBubble: anchor, interactionMode: 'comment' });
    },

    closeCommentBubble() {
      set({ commentBubble: null, selectedElement: null });
    },

    queueCommentForPrompt(id) {
      set((s) => {
        if (s.queuedCommentIds.includes(id)) return {};
        return { queuedCommentIds: [...s.queuedCommentIds, id] };
      });
    },

    unqueueCommentForPrompt(id) {
      set((s) => ({
        queuedCommentIds: s.queuedCommentIds.filter((queuedId) => queuedId !== id),
      }));
    },

    applyLiveRects(entries) {
      set({ liveRects: Object.fromEntries(entries.map(({ selector, rect }) => [selector, rect])) });
    },

    clearLiveRects() {
      set({ liveRects: {} });
    },

    async addComment(input) {
      if (!window.codesign) return null;
      const designId = get().currentDesignId;
      if (!designId) return null;
      // Pin comments to the current snapshot so pin overlays only surface for
      // the snapshot the user was viewing when the click happened.
      let snapshotId: string | null = get().currentSnapshotId;
      if (!snapshotId) {
        try {
          const snaps = await window.codesign.snapshots.list(designId);
          if (get().currentDesignId !== designId) return null;
          snapshotId = snaps[0]?.id ?? null;
          if (snapshotId) set({ currentSnapshotId: snapshotId });
        } catch (err) {
          console.warn('[open-codesign] addComment: failed to look up latest snapshot', err);
        }
      }
      if (!snapshotId) {
        get().pushToast({
          variant: 'error',
          title: tr('notifications.commentNeedsSnapshot'),
        });
        return null;
      }
      if (get().currentDesignId !== designId) return null;
      try {
        const row = await window.codesign.comments.add({
          designId,
          snapshotId,
          kind: input.kind,
          selector: input.selector,
          tag: input.tag,
          outerHTML: input.outerHTML,
          rect: input.rect,
          text: input.text,
          ...(input.scope ? { scope: input.scope } : {}),
          ...(input.parentOuterHTML ? { parentOuterHTML: input.parentOuterHTML } : {}),
          ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
        });
        if (get().currentDesignId === designId) {
          if (!row) {
            return null;
          }
          set((s) => ({ comments: [...s.comments, row] }));
        }
        return row;
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('notifications.commentCreateFailed'),
          description: msg,
        });
        return null;
      }
    },

    async updateComment(id, patch) {
      if (!window.codesign) return null;
      const designId = get().currentDesignId;
      if (!designId) return null;
      const wasQueued = get().queuedCommentIds.includes(id);
      try {
        const updated = await window.codesign.comments.update(designId, id, patch);
        if (!updated) return null;
        set((s) =>
          s.currentDesignId !== designId
            ? {}
            : {
                comments: s.comments.map((c) => (c.id === id ? updated : c)),
                ...(updated.kind !== 'edit' || updated.status !== 'pending'
                  ? { queuedCommentIds: s.queuedCommentIds.filter((queuedId) => queuedId !== id) }
                  : wasQueued && !s.queuedCommentIds.includes(id)
                    ? { queuedCommentIds: [...s.queuedCommentIds, id] }
                    : {}),
              },
        );
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('notifications.commentUpdateFailed'),
          description: msg,
        });
        return null;
      }
    },

    async submitComment(input) {
      // Route by presence of existingCommentId. The anchor on a reopened chip
      // carries the id, so editing text hits updateComment (no duplicate row);
      // a fresh click in comment mode can still reuse an existing pending row
      // for the same snapshot + selector, then falls through to addComment
      // only when this is genuinely a new anchor. Both return the row on
      // success so the bubble can decide whether to close.
      if (input.existingCommentId) {
        return get().updateComment(input.existingCommentId, { text: input.text });
      }
      const snapshotId = get().currentSnapshotId;
      const comments = get().comments;
      let existingForSelector: CodesignState['comments'][number] | null = null;
      for (let index = comments.length - 1; index >= 0; index--) {
        const comment = comments[index];
        if (
          comment?.kind === 'edit' &&
          comment.status === 'pending' &&
          comment.selector === input.selector &&
          comment.sourcePath === input.sourcePath
        ) {
          if (snapshotId !== null && comment.snapshotId === snapshotId) {
            existingForSelector = comment;
            break;
          }
          existingForSelector ??= comment;
        }
      }
      if (existingForSelector !== null) {
        return get().updateComment(existingForSelector.id, { text: input.text });
      }
      const payload: Parameters<CodesignState['addComment']>[0] = {
        kind: input.kind,
        selector: input.selector,
        tag: input.tag,
        outerHTML: input.outerHTML,
        rect: input.rect,
        text: input.text,
      };
      if (input.scope) payload.scope = input.scope;
      if (input.parentOuterHTML) payload.parentOuterHTML = input.parentOuterHTML;
      if (input.sourcePath) payload.sourcePath = input.sourcePath;
      return get().addComment(payload);
    },

    async removeComment(id) {
      if (!window.codesign) return;
      const designId = get().currentDesignId;
      if (!designId) return;
      try {
        await window.codesign.comments.remove(designId, id);
        set((s) => ({
          comments: s.comments.filter((c) => c.id !== id),
          queuedCommentIds: s.queuedCommentIds.filter((queuedId) => queuedId !== id),
          ...(s.commentBubble?.existingCommentId === id
            ? { commentBubble: null, selectedElement: null }
            : {}),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('notifications.commentDeleteFailed'),
          description: msg,
        });
      }
    },
  };
}
