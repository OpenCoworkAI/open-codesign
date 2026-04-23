import { useT } from '@open-codesign/i18n';
import { FolderOpen, PencilRuler, X } from 'lucide-react';
import { useCodesignStore } from '../store';

function fileTabLabel(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

export function CanvasTabBar() {
  const t = useT();
  const tabs = useCodesignStore((s) => s.canvasTabs);
  const active = useCodesignStore((s) => s.activeCanvasTab);
  const setActive = useCodesignStore((s) => s.setActiveCanvasTab);
  const close = useCodesignStore((s) => s.closeCanvasTab);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t('canvas.tabsAriaLabel')}
      className="flex items-stretch min-w-0"
    >
      {tabs.map((tab, index) => {
        const isActive = index === active;
        const isFiles = tab.kind === 'files';
        const isCanvas = tab.kind === 'canvas';
        const label = isFiles
          ? t('canvas.filesTab')
          : isCanvas
            ? t('canvas.canvasTab')
            : fileTabLabel((tab as { path: string }).path);
        const title = isFiles
          ? t('canvas.filesTab')
          : isCanvas
            ? t('canvas.canvasTab')
            : (tab as { path: string }).path;
        const key: string = isFiles
          ? 'files'
          : isCanvas
            ? 'canvas'
            : `file:${(tab as { path: string }).path}`;
        return (
          <div
            key={key}
            role="tab"
            aria-selected={isActive}
            className={`group relative flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[7px] text-[12px] transition-colors duration-[var(--duration-faster)] ${
              isActive
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <button
              type="button"
              onClick={() => setActive(index)}
              title={title}
              className="flex items-center gap-[var(--space-1_5)] focus:outline-none"
            >
              {isFiles ? <FolderOpen className="w-3.5 h-3.5 opacity-80" aria-hidden /> : null}
              {isCanvas ? <PencilRuler className="w-3.5 h-3.5 opacity-80" aria-hidden /> : null}
              <span
                className="truncate max-w-[220px]"
                style={isFiles || isCanvas ? undefined : { fontFamily: 'var(--font-mono)' }}
              >
                {label}
              </span>
            </button>
            {isFiles || isCanvas ? null : (
              <button
                type="button"
                onClick={() => close(index)}
                aria-label={t('canvas.closeTab', { name: label })}
                className="p-[2px] text-[var(--color-text-muted)] opacity-50 hover:opacity-100 hover:text-[var(--color-text-primary)] transition-opacity"
              >
                <X className="w-3 h-3" aria-hidden />
              </button>
            )}
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-[var(--space-2)] bottom-[-1px] h-[1.5px] bg-[var(--color-accent)]"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
