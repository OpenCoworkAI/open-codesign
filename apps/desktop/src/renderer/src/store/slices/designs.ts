import {
  hasWorkspaceSourceReference,
  resolveWorkspacePreviewSource,
} from '../../preview/workspace-source.js';
import type { CodesignState } from '../../store.js';
import { tr } from '../lib/locale.js';
import { recordPreviewInPool } from './snapshots.js';
import { FILES_TAB } from './tabs.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

async function resolveDesignPreviewSource(
  designId: string,
  source: string | null,
): Promise<string | null> {
  if (source === null || !window.codesign) return source;
  const referencesWorkspaceSource = hasWorkspaceSourceReference(source);
  const resolved = await resolveWorkspacePreviewSource({
    designId,
    source,
    path: 'index.html',
    read: window.codesign.files?.read,
    requireReferencedSource: referencesWorkspaceSource,
  });
  return resolved.content;
}

interface DesignsSliceActions {
  loadDesigns: CodesignState['loadDesigns'];
  ensureCurrentDesign: CodesignState['ensureCurrentDesign'];
  openNewDesignDialog: CodesignState['openNewDesignDialog'];
  closeNewDesignDialog: CodesignState['closeNewDesignDialog'];
  createNewDesign: CodesignState['createNewDesign'];
  switchDesign: CodesignState['switchDesign'];
  renameCurrentDesign: CodesignState['renameCurrentDesign'];
  renameDesign: CodesignState['renameDesign'];
  duplicateDesign: CodesignState['duplicateDesign'];
  softDeleteDesign: CodesignState['softDeleteDesign'];
  openDesignsView: CodesignState['openDesignsView'];
  closeDesignsView: CodesignState['closeDesignsView'];
  requestDeleteDesign: CodesignState['requestDeleteDesign'];
  requestRenameDesign: CodesignState['requestRenameDesign'];
  requestWorkspaceRebind: CodesignState['requestWorkspaceRebind'];
  cancelWorkspaceRebind: CodesignState['cancelWorkspaceRebind'];
  confirmWorkspaceRebind: CodesignState['confirmWorkspaceRebind'];
}

export function makeDesignsSlice(set: SetState, get: GetState): DesignsSliceActions {
  return {
    async loadDesigns() {
      if (!window.codesign) return;
      try {
        const designs = await window.codesign.snapshots.listDesigns();
        set({ designs, designsLoaded: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.loadFailed'),
          description: msg,
        });
        set({ designsLoaded: true });
        throw err instanceof Error ? err : new Error(msg);
      }
    },

    async ensureCurrentDesign() {
      if (!window.codesign) return;
      await get().loadDesigns();
      const designs = get().designs;
      if (get().currentDesignId !== null) return;

      if (designs.length > 0) {
        const first = designs[0];
        if (first) await get().switchDesign(first.id);
        return;
      }
      // No designs exist yet — create the first one silently. The user can
      // rename it later or just send a prompt and we'll auto-name it.
      await get().createNewDesign();
    },

    openNewDesignDialog() {
      set({ newDesignDialogOpen: true });
    },
    closeNewDesignDialog() {
      set({ newDesignDialogOpen: false });
    },

    async createNewDesign(workspacePath?: string | null) {
      if (!window.codesign) return null;
      if (get().isGenerating) {
        // Don't silently drop the request — callers like the Examples flow
        // assume "clicked = new design". A hidden no-op makes the prompt appear
        // to have vanished into the current design instead.
        get().pushToast({
          variant: 'info',
          title: tr('projects.notifications.createFailed'),
          description: tr('projects.notifications.busyGenerating'),
        });
        return null;
      }
      const existingNames = new Set(get().designs.map((d) => d.name));
      let n = 1;
      while (existingNames.has(`Untitled design ${n}`)) n += 1;
      const name = `Untitled design ${n}`;
      try {
        const design = await window.codesign.snapshots.createDesign(name);
        set({
          currentDesignId: design.id,
          previewHtml: null,
          errorMessage: null,
          iframeErrors: [],
          selectedElement: null,
          lastPromptInput: null,
          designsViewOpen: false,
          chatMessages: [],
          chatLoaded: false,
          pendingToolCalls: [],
          comments: [],
          commentsLoaded: false,
          commentBubble: null,
          currentSnapshotId: null,
          canvasTabs: [FILES_TAB],
          activeCanvasTab: 0,
        });
        await get().loadDesigns();
        void get().loadChatForCurrentDesign();
        void get().loadCommentsForCurrentDesign();
        if (workspacePath) {
          try {
            await window.codesign.snapshots.updateWorkspace(design.id, workspacePath, false);
            await get().loadDesigns();
          } catch (err) {
            const msg = err instanceof Error ? err.message : tr('errors.unknown');
            get().pushToast({
              variant: 'error',
              title: tr('canvas.workspace.updateFailed'),
              description: msg,
            });
          }
        }
        return design;
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.createFailed'),
          description: msg,
        });
        return null;
      }
    },

    async switchDesign(id: string) {
      if (!window.codesign) return;
      const state = get();
      if (state.currentDesignId === id) {
        set({ designsViewOpen: false });
        void (async () => {
          try {
            const snapshots = await window.codesign?.snapshots.list(id);
            if (!snapshots || get().currentDesignId !== id) return;
            const latest = snapshots[0] ?? null;
            const fresh = await resolveDesignPreviewSource(
              id,
              latest ? latest.artifactSource : null,
            );
            if (fresh !== null && fresh !== get().previewHtml) {
              const refreshed = recordPreviewInPool(
                get().previewHtmlByDesign,
                get().recentDesignIds,
                id,
                fresh,
              );
              set({
                previewHtml: fresh,
                previewHtmlByDesign: refreshed.cache,
                recentDesignIds: refreshed.recent,
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : tr('errors.unknown');
            get().pushToast({
              variant: 'error',
              title: tr('projects.notifications.switchFailed'),
              description: msg,
            });
          }
        })();
        return;
      }

      // Snapshot the OUTGOING design's preview into the pool so that switching
      // back is instant. The cache key is the design id; PreviewPane keeps a
      // hidden iframe per pool entry.
      const outgoingPool =
        state.currentDesignId !== null && state.previewHtml !== null
          ? recordPreviewInPool(
              state.previewHtmlByDesign,
              state.recentDesignIds,
              state.currentDesignId,
              state.previewHtml,
            )
          : { cache: state.previewHtmlByDesign, recent: state.recentDesignIds };

      // Cache hit on the incoming design — render instantly, refresh in the
      // background so any external edits eventually land.
      const cachedHtml = outgoingPool.cache[id];
      if (cachedHtml !== undefined) {
        const incomingPool = recordPreviewInPool(
          outgoingPool.cache,
          outgoingPool.recent,
          id,
          cachedHtml,
        );
        set({
          currentDesignId: id,
          previewHtml: cachedHtml,
          previewHtmlByDesign: incomingPool.cache,
          recentDesignIds: incomingPool.recent,
          errorMessage: null,
          iframeErrors: [],
          selectedElement: null,
          lastPromptInput: null,
          designsViewOpen: false,
          chatMessages: [],
          chatLoaded: false,
          pendingToolCalls: [],
          comments: [],
          commentsLoaded: false,
          commentBubble: null,
          currentSnapshotId: null,
          canvasTabs: [FILES_TAB, { kind: 'file', path: 'index.html' }],
          activeCanvasTab: 1,
        });
        void get().loadChatForCurrentDesign();
        void get().loadCommentsForCurrentDesign();
        void (async () => {
          try {
            const snapshots = await window.codesign?.snapshots.list(id);
            if (!snapshots || get().currentDesignId !== id) return;
            const latest = snapshots[0] ?? null;
            const fresh = await resolveDesignPreviewSource(
              id,
              latest ? latest.artifactSource : null,
            );
            if (fresh !== null && fresh !== get().previewHtml) {
              const refreshed = recordPreviewInPool(
                get().previewHtmlByDesign,
                get().recentDesignIds,
                id,
                fresh,
              );
              set({
                previewHtml: fresh,
                previewHtmlByDesign: refreshed.cache,
                recentDesignIds: refreshed.recent,
              });
            }
          } catch {
            // Background refresh failure is harmless — cached preview remains.
          }
        })();
        return;
      }

      // Cold path — first visit (or evicted from pool). Pay the IPC + parse cost.
      try {
        const snapshots = await window.codesign.snapshots.list(id);
        const latest = snapshots[0] ?? null;
        const html = await resolveDesignPreviewSource(id, latest ? latest.artifactSource : null);
        const incomingPool = recordPreviewInPool(outgoingPool.cache, outgoingPool.recent, id, html);
        set({
          currentDesignId: id,
          previewHtml: html,
          previewHtmlByDesign: incomingPool.cache,
          recentDesignIds: incomingPool.recent,
          errorMessage: null,
          iframeErrors: [],
          selectedElement: null,
          lastPromptInput: null,
          designsViewOpen: false,
          chatMessages: [],
          chatLoaded: false,
          pendingToolCalls: [],
          comments: [],
          commentsLoaded: false,
          commentBubble: null,
          currentSnapshotId: null,
          canvasTabs: latest ? [FILES_TAB, { kind: 'file', path: 'index.html' }] : [FILES_TAB],
          activeCanvasTab: latest ? 1 : 0,
        });
        void get().loadChatForCurrentDesign();
        void get().loadCommentsForCurrentDesign();
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.switchFailed'),
          description: msg,
        });
      }
    },

    async renameCurrentDesign(name: string) {
      const id = get().currentDesignId;
      if (!id) return;
      await get().renameDesign(id, name);
    },

    async renameDesign(id: string, name: string) {
      if (!window.codesign) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await window.codesign.snapshots.renameDesign(id, trimmed);
        // Optimistic in-memory update. If persistence is unavailable and
        // listDesigns() returns [], a freshly-created design can otherwise
        // disappear from chrome after reload of this slice. If the target row
        // is missing, synthesize one so the sidebar / top bar can surface
        // the name.
        const nowIso = new Date().toISOString();
        set((s) => {
          const existing = s.designs.find((d) => d.id === id);
          if (existing) {
            return {
              designs: s.designs.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
              designToRename: null,
            };
          }
          return {
            designs: [
              ...s.designs,
              {
                schemaVersion: 1 as const,
                id,
                name: trimmed,
                createdAt: nowIso,
                updatedAt: nowIso,
                thumbnailText: null,
                deletedAt: null,
                workspacePath: null,
              },
            ],
            designToRename: null,
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.renameFailed'),
          description: msg,
        });
      }
    },

    async duplicateDesign(id: string) {
      if (!window.codesign) return null;
      const source = get().designs.find((d) => d.id === id);
      if (!source) return null;
      const name = tr('projects.duplicateNameTemplate', { name: source.name });
      try {
        const cloned = await window.codesign.snapshots.duplicateDesign(id, name);
        await get().loadDesigns();
        get().pushToast({
          variant: 'success',
          title: tr('projects.notifications.duplicated', { name: cloned.name }),
        });
        return cloned;
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.duplicateFailed'),
          description: msg,
        });
        return null;
      }
    },

    async softDeleteDesign(id: string) {
      if (!window.codesign) return;
      if (get().isGenerating) {
        get().pushToast({
          variant: 'info',
          title: tr('projects.notifications.deleteBlockedGenerating'),
        });
        return;
      }
      try {
        await window.codesign.snapshots.softDeleteDesign(id);
        if (get().autoPolishFired.has(id)) {
          const nextFired = new Set(get().autoPolishFired);
          nextFired.delete(id);
          set({ autoPolishFired: nextFired });
        }
        const wasCurrent = get().currentDesignId === id;
        await get().loadDesigns();
        if (wasCurrent) {
          const remaining = get().designs;
          set({
            currentDesignId: null,
            previewHtml: null,
            canvasTabs: [FILES_TAB],
            activeCanvasTab: 0,
          });
          if (remaining.length > 0 && remaining[0]) {
            await get().switchDesign(remaining[0].id);
          } else {
            await get().createNewDesign();
          }
        }
        set({ designToDelete: null });
        get().pushToast({ variant: 'info', title: tr('projects.notifications.deleted') });
      } catch (err) {
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('projects.notifications.deleteFailed'),
          description: msg,
        });
      }
    },

    openDesignsView() {
      void get().loadDesigns();
      set({ designsViewOpen: true });
    },
    closeDesignsView() {
      set({ designsViewOpen: false });
    },
    requestDeleteDesign(design) {
      set({ designToDelete: design });
    },
    requestRenameDesign(design) {
      set({ designToRename: design });
    },

    requestWorkspaceRebind(design, newPath) {
      // Block workspace changes while the current design is generating
      const state = get();
      if (state.isGenerating && state.generatingDesignId === state.currentDesignId) {
        return;
      }
      set({ workspaceRebindPending: { design, newPath } });
    },

    cancelWorkspaceRebind() {
      set({ workspaceRebindPending: null });
    },

    async confirmWorkspaceRebind(migrateFiles) {
      if (!window.codesign) return;
      const pending = get().workspaceRebindPending;
      if (!pending) return;

      const { design, newPath } = pending;
      try {
        await window.codesign.snapshots.updateWorkspace(design.id, newPath, migrateFiles);
        const updated = await window.codesign.snapshots.listDesigns();
        set({ designs: updated, workspaceRebindPending: null });
        get().pushToast({
          variant: 'success',
          title: tr('canvas.workspace.updated'),
        });
      } catch (err) {
        set({ workspaceRebindPending: null });
        const msg = err instanceof Error ? err.message : tr('errors.unknown');
        get().pushToast({
          variant: 'error',
          title: tr('canvas.workspace.updateFailed'),
          description: msg,
        });
        throw err;
      }
    },
  };
}
