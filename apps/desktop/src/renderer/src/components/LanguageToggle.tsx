import { setLocale as applyLocale, getCurrentLocale, useT } from '@open-codesign/i18n';
import type { Locale } from '@open-codesign/i18n';
import { Globe } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

function nextLocale(locale: Locale): Locale {
  return locale === 'en' ? 'zh-CN' : 'en';
}

function localeLabel(locale: Locale): string {
  return locale === 'zh-CN' ? 'ZH' : 'EN';
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
      className="inline-flex items-center gap-[var(--space-2)] h-[var(--size-control-sm)] px-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-xs)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      aria-label={t('settings.language.label')}
      title={t('settings.language.label')}
    >
      <Globe className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)]" />
      <span>{localeLabel(locale)}</span>
    </button>
  );
}
