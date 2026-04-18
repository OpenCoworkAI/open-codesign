import { useT } from '@open-codesign/i18n';
import { IconButton, Tooltip, Wordmark } from '@open-codesign/ui';
import { Command, Settings as SettingsIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCodesignStore } from '../store';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function TopBar() {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const openSettings = useCodesignStore((s) => s.openSettings);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);

  let crumb = t('preview.noDesign');
  if (errorMessage) crumb = t('preview.error.title');
  else if (isGenerating) crumb = t('preview.loading.title');
  else if (previewHtml) crumb = t('preview.ready');

  return (
    <header
      className="h-[44px] shrink-0 flex items-center justify-between pl-[88px] pr-4 border-b border-[var(--color-border)] bg-[var(--color-background)] select-none"
      style={dragStyle}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Wordmark badge={t('common.preAlpha')} size="sm" />
        <span className="text-[var(--color-text-muted)]">/</span>
        <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)] truncate">
          {crumb}
        </span>
      </div>

      <div className="flex items-center gap-1" style={noDragStyle}>
        <Tooltip label={t('commands.tooltips.commandPalette')}>
          <IconButton label={t('commands.openPalette')} size="sm" onClick={openCommandPalette}>
            <Command className="w-4 h-4" />
          </IconButton>
        </Tooltip>
        <LanguageToggle />
        <ThemeToggle />
        <Tooltip label={t('commands.tooltips.settings')}>
          <IconButton label={t('commands.items.openSettings')} size="sm" onClick={openSettings}>
            <SettingsIcon className="w-4 h-4" />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
