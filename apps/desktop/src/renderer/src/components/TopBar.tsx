import { useT } from '@open-codesign/i18n';
import { IconButton, Tooltip, Wordmark } from '@open-codesign/ui';
import { Command, Settings as SettingsIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCodesignStore } from '../store';
import { ConnectionStatusDot } from './ConnectionStatusDot';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// Shell badge — mock data. Full cost accounting tracked separately.
function ByokBadge() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);

  const provider = config?.provider ?? null;
  const model = config?.modelPrimary ?? null;

  if (!provider || !model) return null;

  // Shorten common provider names for display
  const providerLabel =
    provider === 'anthropic'
      ? 'Claude'
      : provider === 'openai'
        ? 'OpenAI'
        : provider === 'openrouter'
          ? 'OpenRouter'
          : provider;

  // Truncate model slug to the key qualifier (e.g. "claude-sonnet-4-5" → "sonnet-4-5")
  const modelLabel = model.replace(/^(claude-|gpt-|gemini-)/, '');

  return (
    <div
      className="group flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] select-none"
      title={t('topbar.byokTitle')}
    >
      {/* Provider + model chip — model hidden until hover to keep TopBar uncluttered */}
      <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-none">
        {providerLabel}
        <span className="hidden group-hover:inline">
          <span className="mx-[var(--space-1)] text-[var(--color-border-strong)]">·</span>
          <span className="text-[var(--color-text-muted)]">{modelLabel}</span>
        </span>
      </span>

      <span className="w-px h-[var(--size-icon-xs)] bg-[var(--color-border)]" aria-hidden="true" />

      {/* Cost this week — tabular mono numerals */}
      <Tooltip label={t('topbar.spendTooltip')}>
        <span
          className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-none"
          style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
        >
          $0.00
          <span
            className="ml-[var(--space-1)] text-[var(--color-text-muted)]"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            {t('topbar.spendThisWeek')}
          </span>
        </span>
      </Tooltip>
    </div>
  );
}

export function TopBar() {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const setView = useCodesignStore((s) => s.setView);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);

  let crumb = t('preview.noDesign');
  if (errorMessage) crumb = t('preview.error.title');
  else if (isGenerating) crumb = t('preview.loading.title');
  else if (previewHtml) crumb = t('preview.ready');

  return (
    <header
      className="h-[var(--size-titlebar-height)] shrink-0 flex items-center justify-between pl-[var(--size-titlebar-pad-left)] pr-[var(--space-4)] border-b border-[var(--color-border)] bg-[var(--color-background)] select-none"
      style={dragStyle}
    >
      <div className="flex items-center gap-[var(--space-3)] min-w-0">
        <Wordmark badge={t('common.preAlpha')} size="sm" />
        <span className="text-[var(--color-text-muted)]">/</span>
        <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)] truncate">
          {crumb}
        </span>
        <ConnectionStatusDot />
      </div>

      <div className="flex items-center gap-[var(--space-2)]" style={noDragStyle}>
        <ByokBadge />
        <div className="flex items-center gap-[var(--space-1)]">
          <Tooltip label={t('commands.tooltips.commandPalette')}>
            <IconButton label={t('commands.openPalette')} size="sm" onClick={openCommandPalette}>
              <Command className="w-[var(--size-icon-md)] h-[var(--size-icon-md)]" />
            </IconButton>
          </Tooltip>
          <LanguageToggle />
          <ThemeToggle />
          <Tooltip label={t('commands.tooltips.settings')}>
            <IconButton
              label={t('commands.items.openSettings')}
              size="sm"
              onClick={() => setView('settings')}
            >
              <SettingsIcon className="w-[var(--size-icon-md)] h-[var(--size-icon-md)]" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
