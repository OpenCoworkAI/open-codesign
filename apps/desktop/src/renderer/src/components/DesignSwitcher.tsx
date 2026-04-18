import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { Check, ChevronDown, FolderOpen, Pencil, Plus } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../store';

const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const RECENT_LIMIT = 5;

export function DesignSwitcher() {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const openDesignsView = useCodesignStore((s) => s.openDesignsView);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = designs.find((d) => d.id === currentDesignId) ?? null;
  const others = designs.filter((d) => d.id !== currentDesignId).slice(0, RECENT_LIMIT);

  const label = current?.name ?? t('projects.untitled');

  return (
    <div ref={wrapperRef} className="relative" style={noDragStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('projects.switcher.menuLabel')}
        className="inline-flex items-center gap-1.5 max-w-[260px] rounded-[var(--radius-md)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <span className="truncate font-medium">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t('projects.switcher.menuLabel')}
          className="absolute left-0 top-[calc(100%+4px)] z-40 w-[300px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] shadow-[var(--shadow-elevated)] overflow-hidden"
        >
          {current ? (
            <div className="px-3 pt-3 pb-2 border-b border-[var(--color-border-muted)]">
              <div className="text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium mb-1">
                {t('projects.switcher.currentLabel')}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-sm)] text-[var(--color-text-primary)] truncate">
                  {current.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    requestRenameDesign(current);
                  }}
                  className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors px-1.5 py-0.5 rounded"
                >
                  <Pencil className="w-3 h-3" />
                  {t('projects.switcher.renameCurrent')}
                </button>
              </div>
            </div>
          ) : null}

          <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium">
            {t('projects.switcher.recent')}
          </div>
          <ul className="max-h-[260px] overflow-y-auto pb-1">
            {others.length === 0 ? (
              <li className="px-3 py-2 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                {t('projects.switcher.noOthers')}
              </li>
            ) : (
              others.map((d) => (
                <DesignRow
                  key={d.id}
                  design={d}
                  onPick={() => {
                    setOpen(false);
                    void switchDesign(d.id);
                  }}
                />
              ))
            )}
          </ul>

          <div className="border-t border-[var(--color-border-muted)] py-1">
            <MenuRow
              icon={<Plus className="w-3.5 h-3.5" />}
              label={t('projects.switcher.newDesign')}
              shortcut="Ctrl/Cmd+N"
              onClick={() => {
                setOpen(false);
                void createNewDesign();
              }}
            />
            <MenuRow
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              label={t('projects.switcher.viewAll')}
              onClick={() => {
                setOpen(false);
                openDesignsView();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DesignRow({ design, onPick }: { design: Design; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <Check className="w-3.5 h-3.5 text-transparent shrink-0" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block text-[var(--text-sm)] text-[var(--color-text-primary)] truncate">
            {design.name}
          </span>
        </span>
      </button>
    </li>
  );
}

function MenuRow({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
    >
      <span className="text-[var(--color-text-secondary)] shrink-0 inline-flex">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut ? (
        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
