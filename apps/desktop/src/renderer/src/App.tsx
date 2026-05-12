import { useT } from '@open-codesign/i18n';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CommentsPanel } from './components/comment/CommentsPanel';
import { DeleteDesignDialog } from './components/DeleteDesignDialog';
import { DesignsView } from './components/DesignsView';
import { ReportEventDialog } from './components/diagnostics/ReportEventDialog';
import { NewDesignDialog } from './components/NewDesignDialog';
import { PermissionDialog } from './components/PermissionDialog';
import { RebindWorkspaceDialog } from './components/RebindWorkspaceDialog';
import { RenameDesignDialog } from './components/RenameDesignDialog';
import { Sidebar } from './components/Sidebar';
import { ToastViewport } from './components/Toast';
import { TopBar } from './components/TopBar';
import { UpdateBanner } from './components/UpdateBanner';
import { useAgentStream } from './hooks/useAgentStream';
import { useKeyboard } from './hooks/useKeyboard';
import { useUpdateWiring } from './hooks/useUpdateWiring';

// Settings opens in a separate view (Hub ↔ Workspace ↔ Settings). Keep it
// out of the first-paint chunk — its ~2700-line tree + dynamic provider
// cards add ~16kb gzipped that users rarely need on launch.
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })));
const PreviewPane = lazy(() =>
  import('./components/PreviewPane').then((m) => ({ default: m.PreviewPane })),
);

import { createUpdateStore } from './state/update-store';
import { useCodesignStore } from './store';
import { HubView } from './views/HubView';

export function App() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const configLoaded = useCodesignStore((s) => s.configLoaded);
  const loadConfig = useCodesignStore((s) => s.loadConfig);
  const loadDesigns = useCodesignStore((s) => s.loadDesigns);
  const syncGenerationStatus = useCodesignStore((s) => s.syncGenerationStatus);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const setView = useCodesignStore((s) => s.setView);
  const view = useCodesignStore((s) => s.view);
  const previousView = useCodesignStore((s) => s.previousView);
  const designsViewOpen = useCodesignStore((s) => s.designsViewOpen);
  const closeDesignsView = useCodesignStore((s) => s.closeDesignsView);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const designToDelete = useCodesignStore((s) => s.designToDelete);
  const designToRename = useCodesignStore((s) => s.designToRename);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);
  const _sidebarCollapsed = useCodesignStore((s) => s.sidebarCollapsed);
  const activeReportLocalId = useCodesignStore((s) => s.activeReportLocalId);
  const closeReportDialog = useCodesignStore((s) => s.closeReportDialog);

  const [prefillPrompt, setPrefillPrompt] = useState<{ id: number; text: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.max(320, Math.round(window.innerWidth * 0.25)),
  );
  const [isResizing, setIsResizing] = useState(false);

  const [updateStore] = useState(() => createUpdateStore({ dismissedVersion: '' }));
  useUpdateWiring(updateStore);
  useAgentStream();

  useEffect(() => {
    if (!window.codesign) {
      updateStore.getState().markDismissedVersionReady('');
      return;
    }
    window.codesign.preferences
      .get()
      .then((prefs) => {
        updateStore.getState().markDismissedVersionReady(prefs.dismissedUpdateVersion ?? '');
      })
      .catch((err) => {
        console.warn('[App] failed to seed dismissedUpdateVersion', err);
        updateStore.getState().markDismissedVersionReady('');
      });
  }, [updateStore]);
  // Once the user has visited Hub we keep HubView mounted (toggled via
  // `hidden`) so going Workspace → Hub doesn't tear down the design-card
  // iframes and pay the srcDoc parse cost again.
  const [hubMounted, setHubMounted] = useState(view === 'hub');
  useEffect(() => {
    if (view === 'hub') setHubMounted(true);
  }, [view]);
  // Same trick for workspace — once visited, keep PreviewPane mounted so the
  // iframe pool survives Workspace ↔ Hub round trips. Without this, the pool
  // rebuilds 5 iframes from srcDoc every time you come back (2-3s of parse).
  const [workspaceMounted, setWorkspaceMounted] = useState(view === 'workspace');
  useEffect(() => {
    if (view === 'workspace') setWorkspaceMounted(true);
  }, [view]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const maxW = Math.round(window.innerWidth * 0.55);
      const clamped = Math.min(Math.max(ev.clientX, 280), maxW);
      setSidebarWidth(clamped);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      await Promise.all([loadConfig(), loadDesigns()]);
      await syncGenerationStatus();
      const state = useCodesignStore.getState();
      if (state.currentDesignId === null && state.designs.length > 0) {
        const runningDesignId = Object.keys(state.generationByDesign)[0];
        const initialDesign =
          state.designs.find((design) => design.id === runningDesignId) ?? state.designs[0];
        if (initialDesign) await switchDesign(initialDesign.id);
      }
    }
    void bootstrap();
  }, [loadConfig, loadDesigns, switchDesign, syncGenerationStatus]);

  const ready = configLoaded && config?.hasKey;
  const prefillComposer = useCallback((text: string) => {
    setPrefillPrompt((prev) => ({ id: (prev?.id ?? 0) + 1, text }));
  }, []);

  const bindings = useMemo(
    () => [
      {
        combo: 'mod+,',
        handler: () => {
          if (!ready) return;
          setView('settings');
        },
      },
      {
        combo: 'mod+n',
        handler: () => {
          if (!ready) return;
          void createNewDesign();
        },
      },
      {
        combo: 'escape',
        handler: () => {
          if (designToDelete) {
            requestDeleteDesign(null);
            return;
          }
          if (designToRename) {
            requestRenameDesign(null);
            return;
          }
          if (designsViewOpen) {
            closeDesignsView();
            return;
          }
          if (interactionMode !== 'default') {
            setInteractionMode('default');
            return;
          }
          if (view === 'settings') {
            setView(previousView === 'settings' ? 'hub' : previousView);
          }
        },
        preventDefault: false,
      },
    ],
    [
      ready,
      view,
      previousView,
      designsViewOpen,
      designToDelete,
      designToRename,
      interactionMode,
      setInteractionMode,
      setView,
      closeDesignsView,
      createNewDesign,
      requestDeleteDesign,
      requestRenameDesign,
    ],
  );
  useKeyboard(bindings);

  if (!configLoaded) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--color-background)] text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[var(--color-background)]">
      <UpdateBanner store={updateStore} />
      <TopBar />
      <div className="flex-1 min-h-0 relative">
        {view === 'settings' ? (
          <Suspense fallback={null}>
            <Settings />
          </Suspense>
        ) : null}
        {hubMounted ? (
          <div hidden={view !== 'hub'} className="h-full">
            <HubView
              onUseExamplePrompt={async (p) => {
                // Clicking an example is an explicit "start a new thing"
                // intent — always create a fresh design and preload the
                // prompt into IT, never into whatever design the user was
                // last on. If createNewDesign fails (e.g. another run is in
                // flight) it surfaces a toast; we bail so the example prompt
                // doesn't quietly land in the current design's input box.
                const created = await createNewDesign();
                if (!created) return;
                prefillComposer(p);
                setView('workspace');
              }}
            />
          </div>
        ) : null}
        {workspaceMounted ? (
          <div
            hidden={view !== 'workspace'}
            className="h-full min-w-0 overflow-hidden flex flex-col"
          >
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex relative">
              {isResizing && <div className="absolute inset-0 z-20 cursor-col-resize" />}
              <div className="relative shrink-0" style={{ width: sidebarWidth }}>
                <Sidebar prefillPrompt={prefillPrompt} />
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={onResizeStart}
                  className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/15 active:bg-[var(--color-accent)]/25 transition-colors duration-100"
                  style={{ transform: 'translateX(50%)' }}
                />
              </div>
              <main className="flex flex-col min-h-0 flex-1 min-w-0">
                <Suspense fallback={null}>
                  <PreviewPane onPickStarter={prefillComposer} />
                </Suspense>
              </main>
            </div>
          </div>
        ) : null}
      </div>
      <DesignsView />
      <RenameDesignDialog />
      <DeleteDesignDialog />
      <RebindWorkspaceDialog />
      <NewDesignDialog />
      <ToastViewport />
      <CommentsPanel />
      <PermissionDialog />
      <ReportEventDialog localId={activeReportLocalId} onClose={closeReportDialog} />
    </div>
  );
}
