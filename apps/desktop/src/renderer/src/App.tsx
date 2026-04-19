import { useT } from '@open-codesign/i18n';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { DeleteDesignDialog } from './components/DeleteDesignDialog';
import { DesignsView } from './components/DesignsView';
import { PreviewPane } from './components/PreviewPane';
import { RenameDesignDialog } from './components/RenameDesignDialog';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { ToastViewport } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useKeyboard } from './hooks/useKeyboard';
import { Onboarding } from './onboarding';
import { useCodesignStore } from './store';
import { HubView } from './views/HubView';

export function App() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const configLoaded = useCodesignStore((s) => s.configLoaded);
  const loadConfig = useCodesignStore((s) => s.loadConfig);
  const loadDesigns = useCodesignStore((s) => s.loadDesigns);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const setView = useCodesignStore((s) => s.setView);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);
  const closeCommandPalette = useCodesignStore((s) => s.closeCommandPalette);
  const view = useCodesignStore((s) => s.view);
  const commandPaletteOpen = useCodesignStore((s) => s.commandPaletteOpen);
  const designsViewOpen = useCodesignStore((s) => s.designsViewOpen);
  const closeDesignsView = useCodesignStore((s) => s.closeDesignsView);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const designToDelete = useCodesignStore((s) => s.designToDelete);
  const designToRename = useCodesignStore((s) => s.designToRename);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);

  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      await Promise.all([loadConfig(), loadDesigns()]);
      const state = useCodesignStore.getState();
      if (state.currentDesignId === null && state.designs.length > 0) {
        const first = state.designs[0];
        if (first) await switchDesign(first.id);
      }
    }
    void bootstrap();
  }, [loadConfig, loadDesigns, switchDesign]);

  function submit(): void {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    void sendPrompt({ prompt: trimmed });
    setPrompt('');
  }

  const ready = configLoaded && config !== null && config.hasKey;

  const bindings = useMemo(
    () => [
      {
        combo: 'mod+enter',
        handler: () => {
          if (!ready) return;
          const trimmed = prompt.trim();
          if (!trimmed || isGenerating) return;
          void sendPrompt({ prompt: trimmed });
          setPrompt('');
        },
      },
      {
        combo: 'mod+,',
        handler: () => {
          if (!ready) return;
          setView('settings');
        },
      },
      {
        combo: 'mod+k',
        handler: () => {
          if (!ready) return;
          openCommandPalette();
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
          if (commandPaletteOpen) {
            closeCommandPalette();
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
            setView('workspace');
            return;
          }
          if (view === 'workspace') {
            setView('hub');
          }
        },
        preventDefault: false,
      },
    ],
    [
      prompt,
      isGenerating,
      ready,
      sendPrompt,
      view,
      commandPaletteOpen,
      designsViewOpen,
      designToDelete,
      designToRename,
      interactionMode,
      setInteractionMode,
      setView,
      openCommandPalette,
      closeCommandPalette,
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

  if (config === null || !config.hasKey) {
    return <Onboarding />;
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <TopBar />
      <div className="flex-1 min-h-0">
        {view === 'settings' ? (
          <Settings />
        ) : view === 'hub' ? (
          <HubView
            onUseExamplePrompt={(p) => {
              setPrompt(p);
              setView('workspace');
            }}
          />
        ) : (
          <div className="h-full flex flex-col">
            <div className="px-[var(--space-5)] py-[var(--space-2)] border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)]">
              <button
                type="button"
                onClick={() => setView('hub')}
                className="inline-flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <ChevronLeft className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" />
                {t('hub.backToHub')}
              </button>
            </div>
            <div className="flex-1 min-h-0 grid grid-cols-[var(--size-hub-sidebar)_1fr]">
              <Sidebar prompt={prompt} setPrompt={setPrompt} onSubmit={submit} />
              <main className="flex flex-col min-h-0">
                <PreviewPane onPickStarter={(p) => setPrompt(p)} />
              </main>
            </div>
          </div>
        )}
      </div>
      <CommandPalette />
      <DesignsView />
      <RenameDesignDialog />
      <DeleteDesignDialog />
      <ToastViewport />
    </div>
  );
}
