import { IconButton, Tooltip, Wordmark } from '@open-codesign/ui';
import { Command, Settings as SettingsIcon } from 'lucide-react';
import { useCodesignStore } from '../store';
import { ThemeToggle } from './ThemeToggle';

export function TopBar() {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const openSettings = useCodesignStore((s) => s.openSettings);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);

  let crumb = 'Untitled design';
  if (errorMessage) crumb = 'Error';
  else if (isGenerating) crumb = 'Generating…';
  else if (previewHtml) crumb = 'Preview ready';

  return (
    <header className="h-[44px] shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-background)] select-none">
      <div className="flex items-center gap-3 min-w-0">
        <Wordmark badge="pre-alpha" size="sm" />
        <span className="text-[var(--color-text-muted)]">/</span>
        <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)] truncate">
          {crumb}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip label="Command palette  ⌘K">
          <IconButton label="Open command palette" size="sm" onClick={openCommandPalette}>
            <Command className="w-4 h-4" />
          </IconButton>
        </Tooltip>
        <ThemeToggle />
        <Tooltip label="Settings  ⌘,">
          <IconButton label="Open settings" size="sm" onClick={openSettings}>
            <SettingsIcon className="w-4 h-4" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
