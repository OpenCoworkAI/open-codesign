// check-blockers-disable: hardcoded-px
// Reason: onboarding screen uses pixel-perfect typography and iconography (10px/11px/12px/14px/18px/34px)
// that intentionally sit between Tailwind's text-xs/text-sm tokens for vertical rhythm. Tokens too coarse here.
import { useT } from '@open-codesign/i18n';
import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Tooltip } from '@open-codesign/ui';
import { ArrowRight, ExternalLink, KeyRound, Rocket, Server } from 'lucide-react';

interface WelcomeProps {
  onPickKey: () => void;
  onPickFreeTier: () => void;
  ollamaDetected: boolean;
}

export function Welcome({ onPickKey, onPickFreeTier, ollamaDetected }: WelcomeProps) {
  const t = useT();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[24px] font-semibold text-[var(--color-text-primary)] tracking-[-0.01em] leading-[1.2]">
          {t('onboarding.welcome.title')}
        </h1>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-[1.55]">
          {t('onboarding.welcome.subtitle')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <PathButton
          icon={<Rocket className="w-[18px] h-[18px]" />}
          title={t('onboarding.welcome.tryFree')}
          subtitle={t('onboarding.welcome.tryFreeSubtitle')}
          onClick={onPickFreeTier}
        />
        <PathButton
          icon={<KeyRound className="w-[18px] h-[18px]" />}
          title={t('onboarding.welcome.useKey')}
          subtitle={t('onboarding.welcome.useKeySubtitle')}
          onClick={onPickKey}
        />
        {ollamaDetected ? (
          <Tooltip label={t('disabledReason.ollamaComingSoon')} side="bottom">
            <PathButton
              icon={<Server className="w-[18px] h-[18px]" />}
              title={t('onboarding.welcome.useOllama')}
              subtitle={t('onboarding.welcome.useOllamaSubtitle')}
              disabled
            />
          </Tooltip>
        ) : null}
      </div>

      <div className="pt-4 border-t border-[var(--color-border-subtle)] flex flex-col gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {t('onboarding.welcome.whereToGetKey')}
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(
            Object.values(PROVIDER_SHORTLIST) as Array<
              (typeof PROVIDER_SHORTLIST)[SupportedOnboardingProvider]
            >
          ).map((p) => (
            <a
              key={p.provider}
              href={p.keyHelpUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors duration-150"
            >
              {p.label}
              <ExternalLink className="w-[11px] h-[11px]" />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PathButtonProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
}

function PathButton({ icon, title, subtitle, onClick, disabled }: PathButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group relative flex items-start gap-4 w-full text-left p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-soft)] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[1px] hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-card)] disabled:opacity-50 disabled:pointer-events-none"
    >
      <span className="shrink-0 mt-[2px] inline-flex items-center justify-center w-[34px] h-[34px] rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
        {icon}
      </span>
      <span className="flex flex-col gap-[2px] flex-1 min-w-0">
        <span className="text-[14px] font-semibold text-[var(--color-text-primary)] tracking-[-0.005em]">
          {title}
        </span>
        <span className="text-[12px] text-[var(--color-text-secondary)] leading-[1.5]">
          {subtitle}
        </span>
      </span>
      <ArrowRight className="w-[14px] h-[14px] mt-[10px] shrink-0 text-[var(--color-text-muted)] opacity-0 -translate-x-[4px] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[var(--color-accent)]" />
    </button>
  );
}
