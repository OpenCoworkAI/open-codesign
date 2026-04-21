import { useT } from '@open-codesign/i18n';
import { IconButton, Tooltip } from '@open-codesign/ui';
import { FolderOpen, HardDriveUpload, Link2, Paperclip, Plus, Server } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface AddMenuProps {
  onAttachFiles: () => void;
  onAttachRemoteFile: () => void;
  onLinkDesignSystem: () => void;
  onLinkRemoteDesignSystem: () => void;
  referenceUrl: string;
  onReferenceUrlChange: (value: string) => void;
  hasDesignSystem: boolean;
  hasRemoteProfiles: boolean;
  disabled?: boolean;
}

/**
 * Compact `+` button that opens a three-item popover: attach local files,
 * link/refresh design system repo, reference URL. Replaces the former inline
 * button row so the composer area stays quiet until the user wants context.
 *
 * Lightweight popover (no Radix dep) - closes on outside click or Escape.
 */
export function AddMenu({
  onAttachFiles,
  onAttachRemoteFile,
  onLinkDesignSystem,
  onLinkRemoteDesignSystem,
  referenceUrl,
  onReferenceUrlChange,
  hasDesignSystem,
  hasRemoteProfiles,
  disabled,
}: AddMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent): void {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: globalThis.KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function handleItem(run: () => void) {
    return () => {
      run();
      setOpen(false);
    };
  }

  function handleUrlKey(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Tooltip label={t('sidebar.chat.addMenu.trigger')} side="top">
        <IconButton
          size="sm"
          type="button"
          label={t('sidebar.chat.addMenu.trigger')}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          <Plus className="w-[var(--size-icon-md)] h-[var(--size-icon-md)]" strokeWidth={2} />
        </IconButton>
      </Tooltip>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute bottom-full left-0 mb-[var(--space-2)] z-20 min-w-[240px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-[var(--space-1)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleItem(onAttachFiles)}
            className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2_5)] py-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Paperclip
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)]"
              aria-hidden
            />
            <span className="truncate">{t('sidebar.attachLocalFiles')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasRemoteProfiles}
            onClick={handleItem(onAttachRemoteFile)}
            className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2_5)] py-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Server
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)]"
              aria-hidden
            />
            <span className="truncate">添加远程文件</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleItem(onLinkDesignSystem)}
            className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2_5)] py-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FolderOpen
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)]"
              aria-hidden
            />
            <span className="truncate">
              {hasDesignSystem
                ? t('sidebar.refreshDesignSystemRepo')
                : t('sidebar.linkDesignSystemRepo')}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasRemoteProfiles}
            onClick={handleItem(onLinkRemoteDesignSystem)}
            className="flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2_5)] py-[var(--space-2)] text-left text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <HardDriveUpload
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)]"
              aria-hidden
            />
            <span className="truncate">关联远程设计系统</span>
          </button>
          <div className="flex items-center gap-[var(--space-2)] px-[var(--space-2_5)] py-[var(--space-2)]">
            <Link2
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] text-[var(--color-text-secondary)] shrink-0"
              aria-hidden
            />
            <input
              type="url"
              value={referenceUrl}
              onChange={(e) => onReferenceUrlChange(e.target.value)}
              onKeyDown={handleUrlKey}
              placeholder={t('sidebar.referenceUrl')}
              aria-label={t('sidebar.referenceUrl')}
              className="flex-1 min-w-0 bg-transparent text-[var(--text-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
