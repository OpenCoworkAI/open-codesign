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

const EXPORT_ITEMS: ExportItem[] = [
  { format: 'html', label: 'HTML', ready: true },
  { format: 'pdf', label: 'PDF', ready: false, hint: 'Coming in Phase 2' },
  { format: 'pptx', label: 'PPTX', ready: false, hint: 'Coming in Phase 2' },
  { format: 'zip', label: 'ZIP bundle', ready: false, hint: 'Coming in Phase 2' },
];

export function PreviewToolbar(): ReactElement {
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
    const t = setTimeout(() => dismissToast(), 4000);
    return () => clearTimeout(t);
  }, [toastMessage, dismissToast]);

  const disabled = !previewHtml;

  return (
    <div className="flex items-center justify-end gap-2 px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      {toastMessage && (
        <output className="mr-auto text-xs text-[var(--color-text-secondary)] truncate max-w-[60%]">
          {toastMessage}
        </output>
      )}

      <div className="relative" ref={ref}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] text-sm font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          Export
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] py-1 z-10"
          >
            {EXPORT_ITEMS.map((item) => (
              <button
                key={item.format}
                type="button"
                role="menuitem"
                disabled={!item.ready}
                title={item.ready ? undefined : item.hint}
                onClick={() => {
                  setOpen(false);
                  void exportActive(item.format);
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              >
                <span>{item.label}</span>
                {!item.ready && (
                  <span className="text-xs text-[var(--color-text-muted)]">{item.hint}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
