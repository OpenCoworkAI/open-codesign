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
      className="inline-flex items-center gap-2 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      aria-label={t('settings.language.label')}
      title={t('settings.language.label')}
    >
      <Globe className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
      <span>{localeLabel(locale)}</span>
    </button>
  );
}
