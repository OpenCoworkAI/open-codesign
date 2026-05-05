import { useT } from '@open-codesign/i18n';
import { ArrowUpRight } from 'lucide-react';
import logoWithText from '../assets/logo-with-text.png';

export interface EmptyStateProps {
  onPickStarter: (prompt: string) => void;
}

interface Starter {
  labelKey: string;
  promptKey: string;
  descKey: string;
  accent: string;
}

const STARTERS: Starter[] = [
  {
    labelKey: 'emptyState.starters.landing',
    promptKey: 'starterPrompts.landing',
    descKey: 'emptyState.starterDesc.landing',
    accent: '#b5441a',
  },
  {
    labelKey: 'emptyState.starters.dashboard',
    promptKey: 'starterPrompts.dashboard',
    descKey: 'emptyState.starterDesc.dashboard',
    accent: '#1a7a6d',
  },
  {
    labelKey: 'emptyState.starters.mobile',
    promptKey: 'starterPrompts.mobile',
    descKey: 'emptyState.starterDesc.mobile',
    accent: '#3b6caa',
  },
  {
    labelKey: 'emptyState.starters.pitch',
    promptKey: 'starterPrompts.pitch',
    descKey: 'emptyState.starterDesc.pitch',
    accent: '#8b5e3c',
  },
  {
    labelKey: 'emptyState.starters.email',
    promptKey: 'starterPrompts.email',
    descKey: 'emptyState.starterDesc.email',
    accent: '#6b4c9a',
  },
  {
    labelKey: 'emptyState.starters.portfolio',
    promptKey: 'starterPrompts.portfolio',
    descKey: 'emptyState.starterDesc.portfolio',
    accent: '#2d6a4f',
  },
  {
    labelKey: 'emptyState.starters.casestudy',
    promptKey: 'starterPrompts.casestudy',
    descKey: 'emptyState.starterDesc.casestudy',
    accent: '#142d4c',
  },
  {
    labelKey: 'emptyState.starters.animation',
    promptKey: 'starterPrompts.animation',
    descKey: 'emptyState.starterDesc.animation',
    accent: '#a0522d',
  },
];

export function EmptyState({ onPickStarter }: EmptyStateProps) {
  const t = useT();

  return (
    <div className="h-full flex flex-col items-center justify-center overflow-y-auto select-none px-[var(--space-4)] py-[var(--space-8)]">
      <div className="w-full max-w-[760px] px-[var(--space-8)] flex flex-col items-center my-auto">
        {/* ── Logo with text ── */}
        <div className="flex flex-col items-center mb-[12px]">
          <img
            src={logoWithText}
            alt="Open CoDesign"
            className="h-auto"
            style={{ width: 'clamp(280px, 26vw, 400px)' }}
            draggable={false}
          />
        </div>

        {/* ── Headline ── */}
        <h1
          className="text-center"
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 650,
            fontSize: 'clamp(28px, 3vw, 40px)',
            lineHeight: 1.12,
            letterSpacing: '0',
            color: 'var(--color-text-primary)',
          }}
        >
          {t('emptyState.heading')}
        </h1>

        <p
          className="mt-[14px] text-center"
          style={{
            fontSize: '15px',
            lineHeight: 1.65,
            maxWidth: '380px',
            color: '#8a7e72',
          }}
        >
          {t('emptyState.subline')}
        </p>

        {/* ── Starter grid ── */}
        <div className="w-full mt-[48px]">
          <p
            className="mb-[14px] font-medium uppercase"
            style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#a89e92' }}
          >
            {t('emptyState.tryThese')}
          </p>

          <div className="grid grid-cols-4 gap-[10px]">
            {STARTERS.map((s) => (
              <button
                key={s.labelKey}
                type="button"
                onClick={() => onPickStarter(t(s.promptKey))}
                className="group relative text-left overflow-hidden rounded-[10px] px-[16px] pt-[14px] pb-[12px] transition-all duration-200 ease-out hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)] hover:-translate-y-[2px] active:translate-y-0 active:shadow-none"
                style={{
                  border: `1px solid color-mix(in srgb, ${s.accent} 14%, var(--color-border-muted))`,
                  background: `color-mix(in srgb, ${s.accent} 5%, var(--color-surface))`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `color-mix(in srgb, ${s.accent} 9%, var(--color-surface))`;
                  e.currentTarget.style.borderColor = `color-mix(in srgb, ${s.accent} 35%, transparent)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `color-mix(in srgb, ${s.accent} 5%, var(--color-surface))`;
                  e.currentTarget.style.borderColor = `color-mix(in srgb, ${s.accent} 14%, var(--color-border-muted))`;
                }}
              >
                <span
                  aria-hidden
                  className="absolute top-0 left-[12px] right-[12px] h-[2px] rounded-b-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  style={{ backgroundColor: s.accent }}
                />

                <div className="flex items-start justify-between gap-[6px]">
                  <span
                    className="text-[13px] font-medium leading-[1.35] transition-colors duration-150"
                    style={{ color: s.accent }}
                  >
                    {t(s.labelKey)}
                  </span>
                  <ArrowUpRight
                    className="w-[12px] h-[12px] shrink-0 mt-[2px] opacity-0 group-hover:opacity-70 transition-opacity duration-150"
                    style={{ color: s.accent }}
                  />
                </div>

                <span className="mt-[5px] block text-[11px] leading-[1.5] text-[var(--color-text-muted)]">
                  {t(s.descKey)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
