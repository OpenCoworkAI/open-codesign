import type { Locale } from '@open-codesign/i18n';
import { setLocale as applyLocale, getCurrentLocale, useT } from '@open-codesign/i18n';
import { Globe } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const LOCALE_CYCLE: Locale[] = ['en', 'es', 'pt-BR', 'zh-CN'];

function nextLocale(locale: Locale): Locale {
  const i = LOCALE_CYCLE.indexOf(locale);
  return LOCALE_CYCLE[(i + 1) % LOCALE_CYCLE.length] ?? 'en';
}

function localeLabel(locale: Locale): string {
  if (locale === 'zh-CN') return 'ZH';
  if (locale === 'pt-BR') return 'PT';
  if (locale === 'es') return 'ES';
  return 'EN';
}

export function LanguageToggle() {
  const t = useT();
  const [locale, setLocaleState] = useState<Locale>(getCurrentLocale());

  useEffect(() => {
    setLocaleState(getCurrentLocale());
  }, []);

  async function handleToggle(): Promise<void> {
    const target = nextLocale(locale);
    const persisted = window.codesign ? await window.codesign.locale.set(target) : target;
    const applied = await applyLocale(persisted);
    setLocaleState(applied);
  }

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
      style={noDragStyle}
      className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      aria-label={t('settings.language.label')}
      title={t('settings.language.label')}
    >
      <Globe className="w-[18px] h-[18px] text-[var(--color-text-secondary)]" />
      <span>{localeLabel(locale)}</span>
    </button>
  );
}
