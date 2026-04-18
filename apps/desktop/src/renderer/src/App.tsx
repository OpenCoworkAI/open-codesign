import { useT } from '@open-codesign/i18n';
import { useEffect, useMemo, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { PreviewPane } from './components/PreviewPane';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { ToastViewport } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useKeyboard } from './hooks/useKeyboard';
import { Onboarding } from './onboarding';
import { useCodesignStore } from './store';

export function App() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const configLoaded = useCodesignStore((s) => s.configLoaded);
  const loadConfig = useCodesignStore((s) => s.loadConfig);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const openSettings = useCodesignStore((s) => s.openSettings);
  const closeSettings = useCodesignStore((s) => s.closeSettings);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);
  const closeCommandPalette = useCodesignStore((s) => s.closeCommandPalette);
  const settingsOpen = useCodesignStore((s) => s.settingsOpen);
  const commandPaletteOpen = useCodesignStore((s) => s.commandPaletteOpen);

  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

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
          openSettings();
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
        combo: 'escape',
        handler: () => {
          if (settingsOpen) closeSettings();
          else if (commandPaletteOpen) closeCommandPalette();
        },
        preventDefault: false,
      },
    ],
    [
      prompt,
      isGenerating,
      ready,
      sendPrompt,
      settingsOpen,
      commandPaletteOpen,
      openSettings,
      openCommandPalette,
      closeSettings,
      closeCommandPalette,
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
      <div className="flex-1 grid grid-cols-[360px_1fr] min-h-0">
        <Sidebar prompt={prompt} setPrompt={setPrompt} onSubmit={submit} />
        <main className="flex flex-col min-h-0">
          <PreviewPane onPickStarter={(p) => setPrompt(p)} />
        </main>
      </div>
      <Settings />
      <CommandPalette />
      <ToastViewport />
    </div>
  );
}
