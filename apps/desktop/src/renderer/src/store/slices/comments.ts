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
      set({ commentBubble: anchor });
    },

    closeCommentBubble() {
      set({ commentBubble: null });
    },

    applyLiveRects(entries) {
      if (entries.length === 0) return;
      set((s) => {
        const next = { ...s.liveRects };
        for (const { selector, rect } of entries) {
          next[selector] = rect;
        }
        return { liveRects: next };
      });
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
      try {
        const updated = await window.codesign.comments.update(designId, id, patch);
        if (!updated) return null;
        set((s) => ({
          comments: s.comments.map((c) => (c.id === id ? updated : c)),
        }));
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
      // a fresh click in comment mode falls through to addComment. Both return
      // the row on success so the bubble can decide whether to close.
      if (input.existingCommentId) {
        return get().updateComment(input.existingCommentId, { text: input.text });
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
      return get().addComment(payload);
    },

    async removeComment(id) {
      if (!window.codesign) return;
      const designId = get().currentDesignId;
      if (!designId) return;
      try {
        await window.codesign.comments.remove(designId, id);
        set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }));
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
