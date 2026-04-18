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
      className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 select-none"
      title="BYOK — bring-your-own-key. Full usage tracking coming soon."
    >
      {/* Provider + model chip */}
      <span className="text-[11px] text-[var(--color-text-secondary)] leading-none">
        {providerLabel}
        <span className="mx-1 text-[var(--color-border-strong)]">·</span>
        <span className="text-[var(--color-text-muted)]">{modelLabel}</span>
      </span>

      <span className="w-px h-3 bg-[var(--color-border)]" aria-hidden="true" />

      {/* Cost this week — tabular mono numerals */}
      <Tooltip label="Spending this week (full tracking coming soon)">
        <span
          className="text-[11px] text-[var(--color-text-secondary)] leading-none"
          style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
        >
          $0.00
          <span
            className="ml-1 text-[var(--color-text-muted)]"
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
        <ConnectionStatusDot />
      </div>

      <div className="flex items-center gap-2" style={noDragStyle}>
        <ByokBadge />
        <div className="flex items-center gap-1">
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
      </div>
    </header>
  );
}
