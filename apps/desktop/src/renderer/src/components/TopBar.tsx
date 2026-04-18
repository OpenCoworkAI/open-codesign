import { useT } from '@open-codesign/i18n';
import { IconButton, Tooltip, Wordmark } from '@open-codesign/ui';
import { Command, Settings as SettingsIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCodesignStore } from '../store';
import { ConnectionStatusDot } from './ConnectionStatusDot';
import { DesignSwitcher } from './DesignSwitcher';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// Display the BYOK provider chip and accumulated weekly cost. Weekly totals are
// persisted in localStorage under an ISO-week bucket; resets automatically.
function ByokBadge() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const weekCostUsd = useCodesignStore((s) => s.weekUsage.costUsd);
  const lastUsage = useCodesignStore((s) => s.lastUsage);

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
  // Short label drops a leading provider segment (e.g. "openrouter/elephant-alpha" → "elephant-alpha")
  const shortModelLabel = modelLabel.includes('/')
    ? (modelLabel.split('/').pop() ?? modelLabel)
    : modelLabel;
  const hasFullForm = shortModelLabel !== modelLabel;

  const costLabel = formatCostUsd(weekCostUsd);
  const tooltipParts: string[] = [t('topbar.spendTooltip')];
  if (lastUsage) {
    tooltipParts.push(
      `Last: ${lastUsage.inputTokens.toLocaleString()} in / ${lastUsage.outputTokens.toLocaleString()} out · $${formatCostUsd(lastUsage.costUsd)}`,
    );
  }

  return (
    <div
      className="group flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2)] py-[var(--space-1)] select-none"
      title={`${t('topbar.byokTitle')} — ${providerLabel} · ${modelLabel}`}
    >
      {/* Provider + model chip — short slug always visible; full form expands on hover */}
      <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-none">
        {providerLabel}
        <span className="mx-[var(--space-1)] text-[var(--color-border-strong)]">·</span>
        {hasFullForm ? (
          <>
            <span className="text-[var(--color-text-muted)] group-hover:hidden">
              {shortModelLabel}
            </span>
            <span className="hidden text-[var(--color-text-muted)] group-hover:inline">
              {modelLabel}
            </span>
          </>
        ) : (
          <span className="text-[var(--color-text-muted)]">{modelLabel}</span>
        )}
      </span>

      <span className="w-px h-[var(--size-icon-xs)] bg-[var(--color-border)]" aria-hidden="true" />

      {/* Cost this week — tabular mono numerals */}
      <Tooltip label={tooltipParts.join(' — ')}>
        <span
          className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-none"
          style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
        >
          ${costLabel}
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

export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00';
  // Sub-cent costs are common for cheap providers — show 4 decimals so the
  // user sees a non-zero number after the first request, then collapse to
  // 2 decimals once the bucket grows past a cent.
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

export function TopBar() {
  const t = useT();
  const setView = useCodesignStore((s) => s.setView);
  const openCommandPalette = useCodesignStore((s) => s.openCommandPalette);

  return (
    <header
      className="h-[var(--size-titlebar-height)] shrink-0 flex items-center justify-between pl-[var(--size-titlebar-pad-left)] pr-[var(--space-4)] border-b border-[var(--color-border)] bg-[var(--color-background)] select-none"
      style={dragStyle}
    >
      <div className="flex items-center gap-[var(--space-3)] min-w-0">
        <Wordmark badge={t('common.preAlpha')} size="sm" />
        <span className="text-[var(--color-text-muted)]">/</span>
        <DesignSwitcher />
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
