import { useT } from '@open-codesign/i18n';

export function DesignSystemsTab() {
  const t = useT();
  return (
    <section className="max-w-[60ch] space-y-[var(--space-2)]">
      <h2 className="display text-[var(--text-lg)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0">
        {t('hub.designSystems.title')}
      </h2>
      <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
        {t('hub.designSystems.comingSoon')}
      </p>
    </section>
  );
}
