import type { ConsoleLevel } from '@open-codesign/runtime';
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IframeConsoleLogEntry } from '../store';
import { useCodesignStore } from '../store';

const LEVEL_STYLE: Record<ConsoleLevel, string> = {
  log: 'text-[var(--color-text-primary)]',
  info: 'text-[#3b82f6]',
  warn: 'text-[#f59e0b]',
  error: 'text-[var(--color-error)]',
  debug: 'text-[var(--color-text-muted)]',
};

const LEVEL_BG: Record<ConsoleLevel, string> = {
  log: '',
  info: '',
  warn: 'bg-[color-mix(in_srgb,#f59e0b_6%,transparent)]',
  error: 'bg-[color-mix(in_srgb,var(--color-error)_6%,transparent)]',
  debug: '',
};

function ConsoleRow({ entry }: { entry: IframeConsoleLogEntry }) {
  const time = new Date(entry.timestamp).toTimeString().slice(0, 8);
  const text = entry.args.join(' ');
  return (
    <div
      className={`flex items-start gap-[var(--space-2)] px-[var(--space-3)] py-[2px] font-[ui-monospace,Menlo,monospace] text-[11.5px] leading-[1.5] border-b border-[var(--color-border-muted)]/40 last:border-0 ${LEVEL_BG[entry.level]}`}
    >
      <span className="shrink-0 text-[var(--color-text-muted)] tabular-nums select-none">
        {time}
      </span>
      <span
        className={`shrink-0 w-[36px] uppercase text-[10px] font-bold tracking-wide ${LEVEL_STYLE[entry.level]}`}
      >
        {entry.level}
      </span>
      <span className={`flex-1 break-all whitespace-pre-wrap ${LEVEL_STYLE[entry.level]}`}>
        {text}
      </span>
    </div>
  );
}

export function ConsolePanel() {
  const logs = useCodesignStore((s) => s.consoleLogs);
  const clearConsoleLogs = useCodesignStore((s) => s.clearConsoleLogs);
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: autoscroll when the log list updates
  useEffect(() => {
    if (!open || !stickyRef.current) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [open, logs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  if (logs.length === 0 && !open) return null;

  const badge =
    errorCount > 0 ? (
      <span className="rounded-[3px] bg-[var(--color-error)] text-white text-[10px] px-[5px] py-[1px] tabular-nums font-bold">
        {errorCount}
      </span>
    ) : warnCount > 0 ? (
      <span className="rounded-[3px] bg-[#f59e0b] text-white text-[10px] px-[5px] py-[1px] tabular-nums font-bold">
        {warnCount}
      </span>
    ) : logs.length > 0 ? (
      <span className="rounded-[3px] bg-[var(--color-border)] text-[var(--color-text-muted)] text-[10px] px-[5px] py-[1px] tabular-nums">
        {logs.length}
      </span>
    ) : null;

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]">
      {/* Header */}
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1_5)] select-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-[var(--space-2)] flex-1 min-w-0 text-left"
        >
          <Terminal
            className="w-[13px] h-[13px] shrink-0 text-[var(--color-text-muted)]"
            aria-hidden
          />
          <span className="text-[11.5px] font-medium text-[var(--color-text-secondary)]">
            Console
          </span>
          {badge}
          <span className="ml-auto">
            {open ? (
              <ChevronDown className="w-[13px] h-[13px] text-[var(--color-text-muted)]" />
            ) : (
              <ChevronUp className="w-[13px] h-[13px] text-[var(--color-text-muted)]" />
            )}
          </span>
        </button>
        {logs.length > 0 && (
          <button
            type="button"
            onClick={clearConsoleLogs}
            aria-label="Clear console"
            className="shrink-0 p-[3px] rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Trash2 className="w-[12px] h-[12px]" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={scrollRef}
          className="max-h-[200px] overflow-y-auto border-t border-[var(--color-border-muted)]"
        >
          {logs.length === 0 ? (
            <div className="px-[var(--space-3)] py-[var(--space-2)] text-[11.5px] text-[var(--color-text-muted)] font-[ui-monospace,Menlo,monospace]">
              No output yet.
            </div>
          ) : (
            logs.map((entry, i) => (
              <ConsoleRow key={`log-${i}-${entry.timestamp}-${entry.level}`} entry={entry} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
