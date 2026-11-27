import { useT } from '@open-codesign/i18n';
import { BookmarkPlus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { InspectorSection } from './controls';
import type { PaletteColor } from './palette';

export type InspectorMode = 'page' | 'element';

export interface InspectorRailProps {
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  elementAvailable: boolean;
  elementUnavailableReason?: string | undefined;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  page: ReactNode;
  element: ReactNode;
}

/** Fixed right rail that hosts page-level tokens and the selected element's fields. */
export function InspectorRail({
  mode,
  onModeChange,
  elementAvailable,
  elementUnavailableReason,
  collapsed,
  onCollapsedChange,
  page,
  element,
}: InspectorRailProps) {
  const t = useT();
  if (collapsed) {
    return (
      <aside
        aria-label={t('inspector.title')}
        className="flex h-full w-[40px] shrink-0 flex-col items-center border-l border-[var(--color-border-muted)] bg-[var(--color-surface)] py-[var(--space-2)]"
      >
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          title={t('inspector.expand')}
          aria-label={t('inspector.expand')}
          className="inline-flex size-[28px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          <PanelRightOpen className="size-[16px]" aria-hidden />
        </button>
      </aside>
    );
  }
  const tab = (value: InspectorMode, label: string, disabled = false, title?: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      disabled={disabled}
      title={title}
      onClick={() => onModeChange(value)}
      className={`flex-1 rounded-[var(--radius-sm)] py-[5px] text-[12px] transition-colors duration-[var(--duration-faster)] disabled:cursor-not-allowed disabled:opacity-40 ${
        mode === value
          ? 'bg-[var(--color-surface)] font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {label}
    </button>
  );
  return (
    <aside
      aria-label={t('inspector.title')}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col border-l border-[var(--color-border-muted)] bg-[var(--color-surface)] max-[1100px]:w-[264px]"
    >
      <div className="flex items-center gap-[var(--space-1)] border-b border-[var(--color-border-subtle)] px-[var(--space-2)] py-[var(--space-2)]">
        <div
          role="tablist"
          aria-label={t('inspector.title')}
          className="flex flex-1 gap-[2px] rounded-[var(--radius-md)] bg-[var(--color-surface-hover)] p-[2px]"
        >
          {tab('page', t('inspector.tabs.page'))}
          {tab('element', t('inspector.tabs.element'), !elementAvailable, elementUnavailableReason)}
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          title={t('inspector.collapse')}
          aria-label={t('inspector.collapse')}
          className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          <PanelRightClose className="size-[16px]" aria-hidden />
        </button>
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mode === 'element' ? (
          element
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">{page}</div>
        )}
      </div>
    </aside>
  );
}

/** Read-only DESIGN.md palette and the literals the page already uses, with optional sync back to DESIGN.md. */
export function PageColorsSection({
  palette,
  onSyncToDesignMd,
  syncingDesignMd = false,
}: {
  palette: readonly PaletteColor[];
  onSyncToDesignMd?: (() => void) | undefined;
  syncingDesignMd?: boolean | undefined;
}) {
  const t = useT();
  const design = palette.filter((color) => color.source === 'design');
  const used = palette.filter((color) => color.source === 'used');
  if (design.length === 0 && used.length === 0) return null;

  const syncButton = onSyncToDesignMd ? (
    <button
      type="button"
      disabled={syncingDesignMd}
      onClick={onSyncToDesignMd}
      title={t('inspector.page.syncDesignMd')}
      className="inline-flex items-center gap-[4px] rounded-[var(--radius-sm)] px-[var(--space-1_5)] py-[2px] text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-tint)] disabled:opacity-50"
    >
      <BookmarkPlus className="size-[11px]" aria-hidden />
      {syncingDesignMd ? t('inspector.page.syncingDesignMd') : t('inspector.page.syncDesignMd')}
    </button>
  ) : undefined;

  const tiles = (colors: readonly PaletteColor[]) => (
    <div className="grid grid-cols-4 gap-[var(--space-2)]">
      {colors.map((color) => (
        <div key={`${color.source}:${color.value}`} className="min-w-0" title={color.value}>
          <div
            className="h-[28px] rounded-[var(--radius-sm)] shadow-[var(--shadow-inset-soft)]"
            style={{ backgroundColor: color.value }}
          />
          <div className="mt-[3px] truncate text-[10px] text-[var(--color-text-muted)]">
            {color.name || color.value}
            {color.count > 0 ? ` · ${t('inspector.page.usedCount', { count: color.count })}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <>
      {design.length > 0 ? (
        <InspectorSection
          title={t('inspector.page.designColors')}
          action={used.length === 0 ? syncButton : undefined}
        >
          {tiles(design)}
        </InspectorSection>
      ) : null}
      {used.length > 0 ? (
        <InspectorSection title={t('inspector.page.usedColors')} action={syncButton}>
          {tiles(used)}
        </InspectorSection>
      ) : null}
    </>
  );
}
