export function LoadingState() {
  return (
    <div className="h-full p-6">
      <div className="h-full w-full rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col">
        <div className="px-6 py-5 border-b border-[var(--color-border-subtle)] space-y-3">
          <div className="shimmer h-4 w-40 rounded-[var(--radius-sm)]" />
          <div className="shimmer h-3 w-64 rounded-[var(--radius-sm)]" />
        </div>
        <div className="flex-1 grid grid-cols-3 gap-4 p-6">
          <div className="shimmer rounded-[var(--radius-lg)]" />
          <div className="shimmer rounded-[var(--radius-lg)]" />
          <div className="shimmer rounded-[var(--radius-lg)]" />
        </div>
        <div className="px-6 py-5 border-t border-[var(--color-border-subtle)] flex items-center gap-3">
          <div className="shimmer h-3 w-24 rounded-[var(--radius-sm)]" />
          <div className="shimmer h-3 flex-1 rounded-[var(--radius-sm)]" />
          <div className="shimmer h-8 w-20 rounded-[var(--radius-md)]" />
        </div>
      </div>
    </div>
  );
}
