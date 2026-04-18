import { useMemo, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { PreviewPane } from './components/PreviewPane';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { ToastViewport } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useKeyboard } from './hooks/useKeyboard';
import { useCodesignStore } from './store';

export function App() {
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const openSettings = useCodesignStore((s) => s.openSettings);
  const closeSettings = useCodesignStore((s) => s.closeSettings);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);
  const closeCommandPalette = useCodesignStore((s) => s.closeCommandPalette);
  const settingsOpen = useCodesignStore((s) => s.settingsOpen);
  const commandPaletteOpen = useCodesignStore((s) => s.commandPaletteOpen);

  const [prompt, setPrompt] = useState('');

  function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    void sendPrompt(trimmed);
    setPrompt('');
  }

  const bindings = useMemo(
    () => [
      {
        combo: 'mod+enter',
        handler: () => {
          const trimmed = prompt.trim();
          if (!trimmed || isGenerating) return;
          void sendPrompt(trimmed);
          setPrompt('');
        },
      },
      {
        combo: 'mod+,',
        handler: () => openSettings(),
      },
      {
        combo: 'mod+k',
        handler: () => openCommandPalette(),
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

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <TopBar />
      <div className="flex-1 grid grid-cols-[380px_1fr] min-h-0">
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
