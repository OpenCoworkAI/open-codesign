import { Check, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../../store';

export function StickyTodoHeader() {
  const todos = useCodesignStore((s) => s.latestTodos);
  const [expanded, setExpanded] = useState(true);

  if (!todos || todos.length === 0) return null;

  const done = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const inProgress = todos.find((t) => t.status === 'in_progress');

  return (
    <div className="shrink-0 border-b border-[var(--color-border-muted)] bg-[var(--color-surface)]">
      {/* Progress bar + toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-2)] text-left"
      >
        <ListChecks
          className="w-[13px] h-[13px] shrink-0 text-[var(--color-text-muted)]"
          aria-hidden
        />
        <div className="flex-1 h-[3px] rounded-full bg-[var(--color-background-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-[var(--color-text-muted)] shrink-0">
          {done}/{total}
        </span>
        {expanded ? (
          <ChevronUp className="w-[12px] h-[12px] text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronDown className="w-[12px] h-[12px] text-[var(--color-text-muted)] shrink-0" />
        )}
      </button>

      {/* In-progress item preview when collapsed */}
      {!expanded && inProgress && (
        <div className="px-[var(--space-4)] pb-[var(--space-1_5)] text-[12px] font-medium text-[var(--color-text-primary)] truncate">
          {inProgress.text}
        </div>
      )}

      {/* Full list when expanded */}
      {expanded && (
        <div className="px-[var(--space-4)] pb-[var(--space-2)] space-y-[3px]">
          {todos.map((todo, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: todo list is replaced atomically, index is stable per snapshot
              key={i}
              className="flex items-start gap-[var(--space-2)] text-[12px] leading-[1.4]"
            >
              {todo.status === 'completed' ? (
                <span className="mt-[2px] inline-flex items-center justify-center w-[13px] h-[13px] rounded-[3px] bg-[var(--color-accent)] shrink-0">
                  <Check className="w-[9px] h-[9px] text-white" strokeWidth={3} />
                </span>
              ) : todo.status === 'in_progress' ? (
                <span className="mt-[2px] inline-block w-[13px] h-[13px] rounded-[3px] border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 shrink-0 animate-pulse" />
              ) : (
                <span className="mt-[2px] inline-block w-[13px] h-[13px] rounded-[3px] border border-[var(--color-border)] shrink-0" />
              )}
              <span
                className={
                  todo.status === 'completed'
                    ? 'line-through text-[var(--color-text-muted)]'
                    : todo.status === 'in_progress'
                      ? 'text-[var(--color-text-primary)] font-medium'
                      : 'text-[var(--color-text-primary)]'
                }
              >
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
