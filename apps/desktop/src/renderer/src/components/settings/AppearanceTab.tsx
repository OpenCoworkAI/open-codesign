import { setLocale as applyLocale, useT } from '@open-codesign/i18n';
import { useEffect, useState } from 'react';
import { useCodesignStore } from '../../store';
import { cleanIpcError, NativeSelect, Row, SectionTitle } from './primitives';

/**
 * Applies a locale change end-to-end: persists it via the IPC bridge then
 * changes the active i18next language so React components re-render. Exported
 * so it can be unit-tested without a DOM.
 */
export async function applyLocaleChange(
  locale: string,
  localeApi: { set: (locale: string) => Promise<string> },
): Promise<string> {
  const persisted = await localeApi.set(locale);
  const applied = await applyLocale(persisted);
  return applied;
}

export function AppearanceTab() {
  const t = useT();
  const theme = useCodesignStore((s) => s.theme);
  const setTheme = useCodesignStore((s) => s.setTheme);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [locale, setLocale] = useState<string>('en');

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.locale
      .getCurrent()
      .then((l) => setLocale(l))
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.appearance.languageLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function handleLocaleChange(v: string) {
    if (!window.codesign?.locale) {
      pushToast({
        variant: 'error',
        title: t('errors.localePersistFailed'),
        description: t('errors.rendererDisconnected'),
      });
      return;
    }
    try {
      const applied = await applyLocaleChange(v, window.codesign.locale);
      setLocale(applied);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('errors.localePersistFailed'),
        description: cleanIpcError(err) || t('errors.unknown'),
      });
    }
  }

  const themeCards = [
    {
      value: 'light' as const,
      label: t('settings.appearance.lightLabel'),
      desc: t('settings.appearance.lightDesc'),
    },
    {
      value: 'dark' as const,
      label: t('settings.appearance.darkLabel'),
      desc: t('settings.appearance.darkDesc'),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>{t('settings.appearance.themeTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
          {t('settings.appearance.themeHint')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {themeCards.map((card) => {
          const active = theme === card.value;
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => setTheme(card.value)}
              className={`text-left p-4 rounded-[var(--radius-lg)] border transition-colors ${
                active
                  ? 'border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                {card.label}
              </div>
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
                {card.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-[var(--color-border-subtle)]">
        <Row
          label={t('settings.appearance.languageLabel')}
          hint={t('settings.appearance.languageHint')}
        >
          <NativeSelect
            value={locale}
            onChange={handleLocaleChange}
            options={[
              { value: 'en', label: t('settings.appearance.langEn') },
              { value: 'es', label: t('settings.appearance.langEs') },
              { value: 'pt-BR', label: t('settings.appearance.langPtBR') },
              { value: 'zh-CN', label: t('settings.appearance.langZhCN') },
            ]}
          />
        </Row>
      </div>
    </div>
  );
}
