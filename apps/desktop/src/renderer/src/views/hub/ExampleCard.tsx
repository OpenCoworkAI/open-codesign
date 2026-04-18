import { useT } from '@open-codesign/i18n';
import type { LocalizedExample } from '@open-codesign/templates';

export interface ExampleCardProps {
  example: LocalizedExample;
  onUsePrompt: (example: LocalizedExample) => void;
}

/**
 * Single card in the examples gallery.
 *
 * Hover behaviour: subtle lift + accent border (no real video yet — the
 * thumbnail is a stylised inline SVG). When real autoplaying previews ship we
 * swap the SVG for a `<video muted loop autoplay>` keyed off a `videoSrc`
 * field on the example; the rest of the card stays the same.
 */
export function ExampleCard({ example, onUsePrompt }: ExampleCardProps) {
  const t = useT();
  return (
    <article
      className="
        group flex flex-col overflow-hidden
        rounded-[var(--radius-lg)] border border-[var(--color-border)]
        bg-[var(--color-background-secondary)]
        transition-[border-color,transform,box-shadow]
        duration-[var(--duration-base)] ease-[var(--ease-out)]
        hover:-translate-y-[var(--space-0_5)] hover:border-[var(--color-accent)]
        hover:shadow-[var(--shadow-card)]
      "
    >
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(example.thumbnail)}`}
        alt={t('examples.thumbnailAlt', { title: example.title })}
        className="aspect-[16/10] w-full object-cover bg-[var(--color-surface-elevated)]"
      />
      <div className="flex flex-1 flex-col gap-[var(--space-3)] p-[var(--space-4)]">
        <header className="flex items-start justify-between gap-[var(--space-3)]">
          <h3
            className="text-[var(--font-size-body-lg)] font-medium leading-[var(--leading-heading)] text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {example.title}
          </h3>
          <span
            className="
              shrink-0 rounded-full border border-[var(--color-border)]
              px-[var(--space-2)] py-[var(--space-0_5)]
              text-[var(--font-size-body-xs)] uppercase tracking-wide
              text-[var(--color-text-muted)]
            "
          >
            {t(`examples.categories.${example.category}`)}
          </span>
        </header>
        <p className="flex-1 text-[var(--font-size-body-sm)] leading-[var(--leading-body)] text-[var(--color-text-secondary)]">
          {example.description}
        </p>
        <button
          type="button"
          onClick={() => onUsePrompt(example)}
          className="
            self-start rounded-[var(--radius-md)]
            border border-[var(--color-border)]
            bg-[var(--color-background)]
            px-[var(--space-3)] py-[var(--space-2)]
            text-[var(--font-size-body-sm)] font-medium
            text-[var(--color-text-primary)]
            transition-[border-color,background-color,color]
            duration-[var(--duration-fast)] ease-[var(--ease-out)]
            hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]
          "
        >
          {t('examples.useThisPrompt')}
        </button>
      </div>
    </article>
  );
}
