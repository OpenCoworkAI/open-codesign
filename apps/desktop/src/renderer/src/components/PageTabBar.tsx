import { useCodesignStore } from '../store';

function pageLabel(path: string): string {
  if (path === 'index.html') return 'Home';
  // page-about.html → "About"
  const m = path.match(/^page-(.+)\.html$/);
  if (m?.[1]) return m[1].charAt(0).toUpperCase() + m[1].slice(1).replace(/-/g, ' ');
  return path;
}

export function PageTabBar() {
  const pageFiles = useCodesignStore((s) => s.pageFiles);
  const activePagePath = useCodesignStore((s) => s.activePagePath);
  const setActivePagePath = useCodesignStore((s) => s.setActivePagePath);

  const paths = Object.keys(pageFiles).sort((a, b) => {
    if (a === 'index.html') return -1;
    if (b === 'index.html') return 1;
    return a.localeCompare(b);
  });

  // Only show when there are 2+ pages
  if (paths.length < 2) return null;

  return (
    <div className="flex items-center gap-[2px] px-[var(--space-2)] overflow-x-auto shrink-0 border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)]">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          onClick={() => setActivePagePath(path)}
          className={`shrink-0 h-[28px] px-[var(--space-3)] text-[12px] rounded-t-[var(--radius-sm)] transition-colors ${
            path === activePagePath
              ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] font-medium border-x border-t border-[var(--color-border-muted)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {pageLabel(path)}
        </button>
      ))}
    </div>
  );
}
