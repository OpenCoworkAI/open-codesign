import { useT } from '@open-codesign/i18n';
import { Plus } from 'lucide-react';
import { useCodesignStore } from '../../store';
import { DesignGrid } from './DesignGrid';

const RECENT_LIMIT = 6;

export function RecentTab() {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const openNewDesignDialog = useCodesignStore((s) => s.openNewDesignDialog);
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );
  const recent = [...designs]
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, RECENT_LIMIT);

  function handleNewDesign(): void {
    openNewDesignDialog();
  }

  const newDesignTile = (
    <button
      type="button"
      onClick={() => void handleNewDesign()}
      disabled={isGenerating}
      aria-label={t('hub.newDesign')}
      className="group relative flex w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="relative w-full aspect-[4/3] flex flex-col items-center justify-center gap-[var(--space-4)] rounded-[var(--radius-lg)] border-[1.5px] border-dashed border-[var(--color-border)] bg-[linear-gradient(135deg,var(--color-background-secondary)_0%,var(--color-accent-soft)_100%)] transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:border-[var(--color-accent)] group-disabled:translate-y-0 group-disabled:border-[var(--color-border)] overflow-hidden">
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,var(--color-accent-soft)_0%,transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-base)]"
        />
        <span className="relative inline-flex items-center justify-center w-[64px] h-[64px] rounded-full bg-[var(--color-surface)] border border-[var(--color-border-muted)] text-[var(--color-accent)] shadow-[var(--shadow-soft)] group-hover:scale-110 group-hover:shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)]">
          <Plus className="w-[28px] h-[28px]" strokeWidth={2} aria-hidden />
        </span>
        <div className="relative flex flex-col items-center gap-[var(--space-1)] px-[var(--space-4)] text-center">
          <span
            className="text-[var(--text-lg)] text-[var(--color-text-primary)] tracking-[var(--tracking-tight)]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {t('hub.newDesignCardTitle')}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
            {t('hub.newDesignCardSub')}
          </span>
        </div>
      </div>
    </button>
  );

  return (
    <DesignGrid designs={recent} emptyLabel={t('hub.recent.empty')} prefixTile={newDesignTile} />
  );
}
