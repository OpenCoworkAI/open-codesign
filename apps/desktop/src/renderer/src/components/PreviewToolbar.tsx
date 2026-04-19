import { useT } from '@open-codesign/i18n';
import { Tooltip } from '@open-codesign/ui';
import { Download } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import type { ExportFormat } from '../../../preload/index';
import { useCodesignStore } from '../store';

interface ExportItem {
  format: ExportFormat;
  label: string;
  hint?: string;
  ready: boolean;
}

export function PreviewToolbar(): ReactElement {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const exportActive = useCodesignStore((s) => s.exportActive);
  const toastMessage = useCodesignStore((s) => s.toastMessage);
  const dismissToast = useCodesignStore((s) => s.dismissToast);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => dismissToast(), 4000);
    return () => clearTimeout(timeout);
  }, [toastMessage, dismissToast]);

  const disabled = !previewHtml;
  const exportItems: ExportItem[] = [
    {
      format: 'html',
      label: t('export.items.html.label'),
      ready: true,
      hint: t('export.items.html.hint'),
    },
    {
      format: 'pdf',
      label: t('export.items.pdf.label'),
      ready: true,
      hint: t('export.items.pdf.hint'),
    },
    {
      format: 'pptx',
      label: t('export.items.pptx.label'),
      ready: true,
      hint: t('export.items.pptx.hint'),
    },
    {
      format: 'zip',
      label: t('export.items.zip.label'),
      ready: true,
      hint: t('export.items.zip.hint'),
    },
    {
      format: 'markdown',
      label: t('export.items.markdown.label'),
      ready: true,
      hint: t('export.items.markdown.hint'),
    },
  ];

  return (
    <div className="flex items-center justify-end gap-2 px-6 py-2 border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)]">
      {toastMessage && (
        <output className="mr-auto text-[var(--text-xs)] text-[var(--color-text-secondary)] truncate max-w-[60%]">
          {toastMessage}
        </output>
      )}

      <div className="relative" ref={ref}>
        <Tooltip label={disabled ? t('disabledReason.noDesignToExport') : undefined} side="bottom">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-[var(--size-control-sm)] px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Download
              className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]"
              aria-hidden="true"
            />
            {t('export.button')}
          </button>
        </Tooltip>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 min-w-[var(--size-stage-min)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] py-1 z-10"
          >
            {exportItems.map((item) => (
              <button
                key={item.format}
                type="button"
                role="menuitem"
                disabled={!item.ready}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  void exportActive(item.format);
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-[var(--text-sm)] text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors duration-100"
              >
                <span>{item.label}</span>
                {item.hint && (
                  <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate max-w-[60%]">
                    {item.hint}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
