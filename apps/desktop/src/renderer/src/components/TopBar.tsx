import { IconButton, Tooltip } from '@open-codesign/ui';
import { Command, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCodesignStore } from '../store';
import { ThemeToggle } from './ThemeToggle';

const dragRegion: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragRegion: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

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
    <header
      className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border)] bg-[var(--color-background)] select-none"
      style={dragRegion}
    >
      <div className="flex items-center gap-3 pl-16 min-w-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            open-codesign
          </span>
        </div>
        <span className="text-[var(--color-text-muted)]">/</span>
        <span className="text-sm text-[var(--color-text-secondary)] truncate">{crumb}</span>
      </div>

      <div className="flex items-center gap-1" style={noDragRegion}>
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
