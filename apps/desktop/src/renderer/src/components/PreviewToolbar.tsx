import { useT } from '@open-codesign/i18n';
import { Tooltip } from '@open-codesign/ui';
import { Download, Monitor, Smartphone, Tablet } from 'lucide-react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import type { ExportFormat } from '../../../preload/index';
import type { PreviewViewport } from '../store';
import { useCodesignStore } from '../store';

interface ExportItem {
  format: ExportFormat;
  label: string;
  hint?: string;
  ready: boolean;
}

interface ViewportItem {
  value: PreviewViewport;
  label: string;
  icon: ReactElement;
}

const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200] as const;

export function PreviewToolbar(): ReactElement {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const exportActive = useCodesignStore((s) => s.exportActive);
  const toastMessage = useCodesignStore((s) => s.toastMessage);
  const dismissToast = useCodesignStore((s) => s.dismissToast);
  const previewViewport = useCodesignStore((s) => s.previewViewport);
  const setPreviewViewport = useCodesignStore((s) => s.setPreviewViewport);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const setPreviewZoom = useCodesignStore((s) => s.setPreviewZoom);
  const [open, setOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!zoomOpen) return;
    function onClick(e: MouseEvent): void {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) setZoomOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [zoomOpen]);

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

  const viewportItems: ViewportItem[] = [
    {
      value: 'desktop',
      label: t('preview.viewport.desktop'),
      icon: (
        <Monitor className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" aria-hidden="true" />
      ),
    },
    {
      value: 'tablet',
      label: t('preview.viewport.tablet'),
      icon: (
        <Tablet className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" aria-hidden="true" />
      ),
    },
    {
      value: 'mobile',
      label: t('preview.viewport.mobile'),
      icon: (
        <Smartphone
          className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]"
          aria-hidden="true"
        />
      ),
    },
  ];

  return (
    <div className="flex items-center justify-end gap-2 px-6 py-2 border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)]">
      {toastMessage && (
        <output className="mr-auto text-[var(--text-xs)] text-[var(--color-text-secondary)] truncate max-w-[60%]">
          {toastMessage}
        </output>
      )}

      <fieldset
        aria-label={t('preview.viewport.label')}
        className="flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden"
        style={{ margin: 0, padding: 0 }}
      >
        <legend className="sr-only">{t('preview.viewport.label')}</legend>
        {viewportItems.map((item) => {
          const active = previewViewport === item.value;
          return (
            <button
              key={item.value}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setPreviewViewport(item.value)}
              className={[
                'inline-flex items-center justify-center w-[var(--size-control-xs)] h-[var(--size-control-xs)] transition-[background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                active
                  ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              {item.icon}
            </button>
          );
        })}
      </fieldset>

      <div className="relative" ref={zoomRef}>
        <Tooltip
          label={disabled ? t('disabledReason.noDesignToExport') : t('preview.zoom')}
          side="bottom"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => setZoomOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-[var(--size-control-xs)] px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
            aria-haspopup="menu"
            aria-expanded={zoomOpen}
            aria-label={t('preview.zoom')}
          >
            {previewZoom}%
          </button>
        </Tooltip>

        {zoomOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 min-w-[var(--size-menu-compact)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] py-1 z-10"
          >
            {ZOOM_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={previewZoom === value}
                onClick={() => {
                  setPreviewZoom(value);
                  setZoomOpen(false);
                }}
                className={`w-full px-3 py-2 text-[var(--text-sm)] text-left transition-colors duration-100 hover:bg-[var(--color-surface-hover)] ${previewZoom === value ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text-primary)]'}`}
              >
                {value}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={ref}>
        <Tooltip label={disabled ? t('disabledReason.noDesignToExport') : undefined} side="bottom">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-[var(--size-control-xs)] px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] disabled:opacity-40 disabled:pointer-events-none transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
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
