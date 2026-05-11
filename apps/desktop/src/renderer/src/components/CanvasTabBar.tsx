import { useT } from '@open-codesign/i18n';
import { Eye, FolderOpen, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useCodesignStore } from '../store';

function fileTabLabel(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

type CanvasTabForView = { kind: 'preview' } | { kind: 'files' } | { kind: 'file'; path: string };

function tabMeta(
  tab: CanvasTabForView,
  t: ReturnType<typeof useT>,
): {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  mono: boolean;
  closable: boolean;
} {
  if (tab.kind === 'preview') {
    const label = t('canvas.previewTab');
    return {
      key: 'preview',
      label,
      title: label,
      icon: <Eye className="h-3.5 w-3.5 opacity-80" aria-hidden />,
      mono: false,
      closable: false,
    };
  }
  if (tab.kind === 'files') {
    const label = t('canvas.filesTab');
    return {
      key: 'files',
      label,
      title: label,
      icon: <FolderOpen className="h-3.5 w-3.5 opacity-80" aria-hidden />,
      mono: false,
      closable: false,
    };
  }
  return {
    key: `file:${tab.path}`,
    label: fileTabLabel(tab.path),
    title: tab.path,
    icon: null,
    mono: true,
    closable: true,
  };
}

export function CanvasTabBar() {
  const t = useT();
  const tabs = useCodesignStore((s) => s.canvasTabs) as CanvasTabForView[];
  const active = useCodesignStore((s) => s.activeCanvasTab);
  const setActive = useCodesignStore((s) => s.setActiveCanvasTab);
  const close = useCodesignStore((s) => s.closeCanvasTab);
  const hasFileTabs = tabs.some((tab) => tab.kind === 'file');

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t('canvas.tabsAriaLabel')}
      className="codesign-scroll-x flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden"
    >
      {tabs.map((tab, index) => {
        const isActive = index === active;
        const isFilesTab = tab.kind === 'files';
        const isFileTab = tab.kind === 'file';
        const item = tabMeta(tab, t);

        return (
          <Fragment key={item.key}>
            <div
              role="tab"
              aria-selected={isActive}
              className={`group relative flex shrink-0 items-center gap-[var(--space-2)] px-[var(--space-3)] py-[7px] text-[12px] transition-colors duration-[var(--duration-faster)] ${
                isFilesTab
                  ? 'mr-[var(--space-1)] rounded-t-[var(--radius-sm)] bg-[var(--color-background)]'
                  : ''
              } ${isFileTab ? 'rounded-t-[var(--radius-sm)] border-x border-transparent' : ''} ${
                isActive
                  ? isFileTab
                    ? 'border-[var(--color-border-muted)] bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => setActive(index)}
                title={item.title}
                className="flex items-center gap-[var(--space-1_5)] focus:outline-none"
              >
                {item.icon}
                <span
                  className="max-w-[220px] truncate"
                  style={item.mono ? { fontFamily: 'var(--font-mono)' } : undefined}
                >
                  {item.label}
                </span>
              </button>
              {item.closable ? (
                <button
                  type="button"
                  onClick={() => close(index)}
                  aria-label={t('canvas.closeTab', { name: item.label })}
                  className="p-[2px] text-[var(--color-text-muted)] opacity-50 transition-opacity hover:text-[var(--color-text-primary)] hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute inset-x-[var(--space-2)] bottom-[-1px] h-[1.5px] bg-[var(--color-accent)]"
                />
              ) : null}
            </div>
            {isFilesTab && hasFileTabs ? (
              <div
                aria-hidden
                className="my-[7px] h-[18px] w-px shrink-0 bg-[var(--color-border-muted)]"
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
