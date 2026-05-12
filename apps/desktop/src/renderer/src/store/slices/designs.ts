import { DEFAULT_SOURCE_ENTRY } from '@open-codesign/shared';
import {
  resolveDesignPreviewSource,
  type WorkspacePreviewReadResult,
} from '../../preview/workspace-source.js';
import type { CodesignState } from '../../store.js';
import { tr } from '../lib/locale.js';
import { projectGenerationForDesign } from './generation.js';
import { recordPreviewSourceInPool } from './snapshots.js';
import { DEFAULT_CANVAS_TABS } from './tabs.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

async function resolveDesignPreview(
  designId: string,
  snapshotSource: string | null,
): Promise<WorkspacePreviewReadResult | null> {
  if (!window.codesign) return null;
  return resolveDesignPreviewSource({
    designId,
    snapshotSource,
    read: window.codesign.files?.read,
    preferSnapshotSource: true,
  });
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

function buildSelectedDesignState(
  state: CodesignState,
  input: {
    designId: string;
    previewSource: string | null;
    pool: { cache: Record<string, string>; recent: string[] };
    sourcePath?: string | undefined;
  },
): Partial<CodesignState> {
  return {
    currentDesignId: input.designId,
    ...projectGenerationForDesign(state, input.designId),
    previewSource: input.previewSource,
    previewSourceByDesign: input.pool.cache,
    recentDesignIds: input.pool.recent,
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
    canvasTabs:
      input.sourcePath !== undefined
        ? [...DEFAULT_CANVAS_TABS, { kind: 'file', path: input.sourcePath }]
        : DEFAULT_CANVAS_TABS,
    activeCanvasTab: 0,
  };
}

function nextUntitledDesignName(designs: CodesignState['designs']): string {
  const existingNames = new Set(designs.map((d) => d.name));
  let n = 1;
  while (existingNames.has(`Untitled design ${n}`)) n += 1;
  return `Untitled design ${n}`;
}

function buildFreshDesignState(state: CodesignState, designId: string): Partial<CodesignState> {
  return {
    currentDesignId: designId,
    ...projectGenerationForDesign(state, designId),
    previewSource: null,
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
    canvasTabs: DEFAULT_CANVAS_TABS,
    activeCanvasTab: 0,
  };
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
      const name = nextUntitledDesignName(get().designs);
      try {
        const design = await window.codesign.snapshots.createDesign(name, workspacePath);
        set((state) => buildFreshDesignState(state, design.id));
        await get().loadDesigns();
        void get().loadChatForCurrentDesign();
        void get().loadCommentsForCurrentDesign();
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
            const fresh = await resolveDesignPreview(id, latest ? latest.artifactSource : null);
            if (fresh !== null && fresh.content !== get().previewSource) {
              const refreshed = recordPreviewSourceInPool(
                get().previewSourceByDesign,
                get().recentDesignIds,
                id,
                fresh.content,
              );
              set({
                previewSource: fresh.content,
                previewSourceByDesign: refreshed.cache,
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
        state.currentDesignId !== null && state.previewSource !== null
          ? recordPreviewSourceInPool(
              state.previewSourceByDesign,
              state.recentDesignIds,
              state.currentDesignId,
              state.previewSource,
            )
          : { cache: state.previewSourceByDesign, recent: state.recentDesignIds };

      // Cache hit on the incoming design — render instantly, refresh in the
      // background so any external edits eventually land.
      const cachedSource = outgoingPool.cache[id];
      if (cachedSource !== undefined) {
        const incomingPool = recordPreviewSourceInPool(
          outgoingPool.cache,
          outgoingPool.recent,
          id,
          cachedSource,
        );
        set((s) =>
          buildSelectedDesignState(s, {
            designId: id,
            previewSource: cachedSource,
            pool: incomingPool,
            sourcePath: DEFAULT_SOURCE_ENTRY,
          }),
        );
        void get().loadChatForCurrentDesign();
        void get().loadCommentsForCurrentDesign();
        void (async () => {
          try {
            const snapshots = await window.codesign?.snapshots.list(id);
            if (!snapshots || get().currentDesignId !== id) return;
            const latest = snapshots[0] ?? null;
            const fresh = await resolveDesignPreview(id, latest ? latest.artifactSource : null);
            if (fresh !== null && fresh.content !== get().previewSource) {
              const refreshed = recordPreviewSourceInPool(
                get().previewSourceByDesign,
                get().recentDesignIds,
                id,
                fresh.content,
              );
              set({
                previewSource: fresh.content,
                previewSourceByDesign: refreshed.cache,
                recentDesignIds: refreshed.recent,
              });
            }
          } catch {
            // Background refresh failure is harmless — cached preview remains.
          }
        })();
        return;
      }

      // Cold path — first visit (or evicted from pool). Selecting a design must
      // not wait for snapshot/file preview hydration; generating workspaces may
      // still be writing App.jsx when the user clicks the card.
      const incomingPool = recordPreviewSourceInPool(
        outgoingPool.cache,
        outgoingPool.recent,
        id,
        null,
      );
      set((s) =>
        buildSelectedDesignState(s, {
          designId: id,
          previewSource: null,
          pool: incomingPool,
        }),
      );
      void get().loadChatForCurrentDesign();
      void get().loadCommentsForCurrentDesign();
      void (async () => {
        try {
          const snapshots = await window.codesign?.snapshots.list(id);
          if (!snapshots || get().currentDesignId !== id) return;
          const latest = snapshots[0] ?? null;
          const source = await resolveDesignPreview(id, latest ? latest.artifactSource : null);
          if (get().currentDesignId !== id) return;
          const refreshed = recordPreviewSourceInPool(
            get().previewSourceByDesign,
            get().recentDesignIds,
            id,
            source?.content ?? null,
          );
          set({
            previewSource: source?.content ?? null,
            previewSourceByDesign: refreshed.cache,
            recentDesignIds: refreshed.recent,
            canvasTabs: source
              ? [...DEFAULT_CANVAS_TABS, { kind: 'file', path: source.path }]
              : DEFAULT_CANVAS_TABS,
            activeCanvasTab: 0,
          });
        } catch (err) {
          if (get().currentDesignId !== id) return;
          const msg = err instanceof Error ? err.message : tr('errors.unknown');
          get().pushToast({
            variant: 'error',
            title: tr('projects.notifications.switchFailed'),
            description: msg,
          });
        }
      })();
    },

    async renameCurrentDesign(name: string) {
      const id = get().currentDesignId;
      if (!id) return;
      await get().renameDesign(id, name);
    },

    async renameDesign(id: string, name: string, options) {
      if (!window.codesign) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const renameWorkspace =
          options?.renameWorkspace ?? get().generationByDesign[id] === undefined;
        const updated = await window.codesign.snapshots.renameDesign(id, trimmed, {
          renameWorkspace,
        });
        // Use the persisted row instead of synthesizing a partial design; v0.2
        // designs must carry a real workspace binding.
        set((s) => {
          const existing = s.designs.find((d) => d.id === id);
          if (existing) {
            return {
              designs: s.designs.map((d) => (d.id === id ? updated : d)),
              designToRename: null,
            };
          }
          return {
            designs: [...s.designs, updated],
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
      if (get().generationByDesign[id] !== undefined) {
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
            previewSource: null,
            canvasTabs: DEFAULT_CANVAS_TABS,
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
      if (state.generationByDesign[design.id] !== undefined) {
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
