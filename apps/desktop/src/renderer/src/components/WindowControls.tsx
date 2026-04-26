import { type CSSProperties, useEffect, useState } from 'react';

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    function onResize() {
      const electron = (window as unknown as { process: { platform: string } }).process;
      const isMac = electron?.platform === 'darwin';
      if (isMac) return;
      // Best-effort state tracking for Windows
      setMaximized(
        window.innerWidth >= screen.availWidth && window.innerHeight >= screen.availHeight,
      );
    }
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const btn =
    'inline-flex items-center justify-center h-full w-[46px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors';

  return (
    <div
      className="flex items-center h-full"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <button
        type="button"
        onClick={() => window.codesign?.minimize?.()}
        className={btn}
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect y="4.5" width="10" height="1" rx="0.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => window.codesign?.maximize?.()}
        className={btn}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
          >
            <rect x="1.5" y="3.5" width="5" height="5" rx="0.5" />
            <path d="M3.5 3.5V2a0.5 0.5 0 0 1 0.5-0.5h4a0.5 0.5 0 0 1 0.5 0.5v4a0.5 0.5 0 0 1-0.5 0.5H6.5" />
          </svg>
        ) : (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
          >
            <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => window.codesign?.close?.()}
        className={`${btn} hover:bg-[var(--color-error)] hover:text-white`}
        aria-label="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
        >
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
