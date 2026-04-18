import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { relativeTime } from '../lib/relativeTime';
import { useCodesignStore } from '../store';

/**
 * Derive a soft tinted gradient from the design id. Same id always gets the
 * same colors so cards feel stable across renders. Hue rotation only — we
 * stay inside the warm-beige palette by clamping saturation/lightness.
 */
function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 60%, 92%) 0%, hsl(${hue2}, 55%, 85%) 100%)`;
}

export function DesignsView() {
  const t = useT();
  const open = useCodesignStore((s) => s.designsViewOpen);
  const close = useCodesignStore((s) => s.closeDesignsView);
  const designs = useCodesignStore((s) => s.designs);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const duplicateDesign = useCodesignStore((s) => s.duplicateDesign);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);

  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return designs;
    return designs.filter((d) => d.name.toLowerCase().includes(q));
  }, [designs, query]);

  if (!open) return null;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('projects.view.title')}
      className="fixed inset-0 z-40 flex items-stretch justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        className="my-10 mx-6 w-full max-w-5xl rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] flex flex-col overflow-hidden animate-[panel-in_160ms_ease-out]"
        role="document"
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-[var(--color-border-muted)]">
          <div>
            <h2 className="text-[var(--text-lg)] font-medium text-[var(--color-text-primary)] leading-[var(--leading-heading)]">
              {t('projects.view.title')}
            </h2>
            <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
              {t('projects.view.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('projects.view.close')}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border-muted)]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('projects.view.search')}
            className="flex-1 h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150"
          />
          <button
            type="button"
            onClick={() => void createNewDesign()}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('projects.view.newDesign')}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
              {query.trim()
                ? t('projects.view.noMatches', { query: query.trim() })
                : t('projects.view.empty')}
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {filtered.map((d) => (
                <DesignCard
                  key={d.id}
                  design={d}
                  isCurrent={d.id === currentDesignId}
                  onOpen={() => void switchDesign(d.id)}
                  onRename={() => requestRenameDesign(d)}
                  onDuplicate={() => void duplicateDesign(d.id)}
                  onDelete={() => requestDeleteDesign(d)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function DesignCard({
  design,
  isCurrent,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  design: Design;
  isCurrent: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <li className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden hover:shadow-[var(--shadow-card)] hover:border-[var(--color-border-strong)] transition-[box-shadow,border-color] duration-150 ease-[var(--ease-out)] flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full aspect-[4/3] relative text-left"
        style={{ background: gradientFor(design.id) }}
        aria-label={`${t('projects.view.open')} — ${design.name}`}
      >
        {design.thumbnailText ? (
          <span className="absolute inset-0 flex items-end p-3 text-[var(--text-xs)] text-[var(--color-text-primary)] bg-gradient-to-t from-black/10 via-transparent to-transparent">
            <span className="line-clamp-3 leading-[var(--leading-body)]">
              {design.thumbnailText}
            </span>
          </span>
        ) : null}
        {isCurrent ? (
          <span className="absolute top-2 left-2 inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[10px] font-medium uppercase tracking-[var(--tracking-label)]">
            {t('projects.switcher.currentLabel')}
          </span>
        ) : null}
      </button>
      <div className="px-3 pt-2 pb-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="text-left text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate hover:text-[var(--color-accent)] transition-colors"
          >
            {design.name}
          </button>
        </div>
        <div className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
          {t('projects.view.edited', { when: relativeTime(design.updatedAt) })}
        </div>
        <div className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <CardActionButton onClick={onRename} icon={<Pencil className="w-3.5 h-3.5" />}>
            {t('projects.view.rename')}
          </CardActionButton>
          <CardActionButton onClick={onDuplicate} icon={<Copy className="w-3.5 h-3.5" />}>
            {t('projects.view.duplicate')}
          </CardActionButton>
          <CardActionButton onClick={onDelete} icon={<Trash2 className="w-3.5 h-3.5" />} danger>
            {t('projects.view.delete')}
          </CardActionButton>
        </div>
      </div>
    </li>
  );
}

function CardActionButton({
  onClick,
  icon,
  danger = false,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const colorClass = danger
    ? 'text-[var(--color-error)] hover:bg-[var(--color-surface-hover)]'
    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] text-[var(--text-xs)] transition-colors ${colorClass}`}
    >
      {icon}
      {children}
    </button>
  );
}
